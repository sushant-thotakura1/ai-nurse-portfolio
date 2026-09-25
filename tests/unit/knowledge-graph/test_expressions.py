#!/usr/bin/env python3
"""Tests for expression tokenizer, parser, and AST. Spec §5.1-5.3."""
import importlib.util, os, pytest


def load_parser():
    script_path = os.path.join(os.path.dirname(__file__), "../../../scripts/generate-knowledge-graph.py")
    spec = importlib.util.spec_from_file_location("parser", os.path.abspath(script_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

parser = load_parser()


class TestTokenizer:
    def test_simple_comparison(self):
        assert [t[0] for t in parser.tokenize("systolic_bp >= 180")] == ["IDENT", "OP", "NUMBER"]

    def test_duration_literal(self):
        toks = parser.tokenize("delta(weight, 48h)")
        assert ("DURATION", "48h") in [(k, v) for k, v in toks]

    def test_keywords_are_not_identifiers(self):
        kinds = [t[0] for t in parser.tokenize("a AND b OR NOT c")]
        assert kinds == ["IDENT", "AND", "IDENT", "OR", "NOT", "IDENT"]

    def test_unexpected_character_raises(self):
        with pytest.raises(parser.ExpressionError):
            parser.tokenize("weight $ 5")


class TestExpressionParser:
    def test_comparison_ast(self):
        ast = parser.parse_expression("systolic_bp >= 180")
        assert ast == {"kind": "compare", "op": ">=",
                       "left": {"kind": "fact", "name": "systolic_bp"},
                       "right": {"kind": "number", "value": 180}}

    def test_and_or_precedence(self):
        # OR binds loosest: a AND b OR c  ==  (a AND b) OR c
        ast = parser.parse_expression("a AND b OR c")
        assert ast["kind"] == "or"
        assert ast["left"]["kind"] == "and"

    def test_delta_call(self):
        ast = parser.parse_expression("delta(weight, 48h) >= 2")
        assert ast["left"] == {"kind": "call", "func": "delta",
                               "fact": "weight", "window": "48h"}

    def test_n_of_takes_simple_refs(self):
        ast = parser.parse_expression("n_of(2, [redness, systolic_bp >= 180])")
        assert ast["kind"] == "call" and ast["func"] == "n_of" and ast["n"] == 2
        assert len(ast["refs"]) == 2

    def test_persists_takes_simple_ref(self):
        ast = parser.parse_expression("persists(systolic_bp > 140, 3, 7d)")
        assert ast["func"] == "persists" and ast["n"] == 3 and ast["window"] == "7d"
        # "ref" carries the condition being monitored — needed for AST walking
        assert ast["ref"]["kind"] == "compare"
        assert ast["ref"]["left"] == {"kind": "fact", "name": "systolic_bp"}

    # --- the typed grammar must REJECT these (spec §5.1) ---
    def test_number_call_as_boolean_is_rejected(self):
        with pytest.raises(parser.ExpressionError):
            parser.parse_expression("delta(weight, 48h) AND breathlessness")

    def test_boolean_call_as_number_is_rejected(self):
        with pytest.raises(parser.ExpressionError):
            parser.parse_expression("no_reading(weight, 7d) > 5")

    def test_persists_with_compound_expression_is_rejected(self):
        with pytest.raises(parser.ExpressionError):
            parser.parse_expression("persists(a AND b, 3, 7d)")

    def test_not_operator(self):
        ast = parser.parse_expression("NOT breathlessness")
        assert ast == {"kind": "not", "operand": {"kind": "fact", "name": "breathlessness"}}

    def test_not_with_compound(self):
        ast = parser.parse_expression("NOT (a AND b)")
        assert ast["kind"] == "not"
        assert ast["operand"]["kind"] == "and"


class TestExpressionValidator:
    """Tests for validate_expression(ast, facts). Spec §5.5."""

    def _facts(self, **kwargs):
        """Build a minimal facts dict. Each kwarg is name=type_string."""
        result = {}
        for name, ftype in kwargs.items():
            result[name] = {"type": ftype, "unit": "kg" if ftype == "number" else None,
                            "display_name": name, "valid_for": "7d", "valid_for_hours": 168,
                            "required": True, "area": "vitals",
                            "applicable_classifications": [], "applicable_phases": [],
                            "extraction_hint": None}
        return result

    def test_valid_expression_returns_no_errors(self):
        facts = self._facts(systolic_bp="number", breathlessness="boolean")
        ast = parser.parse_expression("systolic_bp >= 140 AND breathlessness")
        errors = parser.validate_expression(ast, facts)
        assert errors == []

    def test_unknown_fact_is_rejected(self):
        facts = self._facts(weight="number")
        ast = parser.parse_expression("undeclared_fact >= 5")
        errors = parser.validate_expression(ast, facts)
        assert len(errors) == 1
        assert "undeclared_fact" in errors[0]

    def test_bare_fact_used_as_boolean_must_be_boolean_type(self):
        facts = self._facts(weight="number")
        # weight is number — using it bare in boolean context is wrong
        # parse "weight AND breathlessness" — weight appears bare in AND context
        ast = {"kind": "and",
               "left": {"kind": "fact", "name": "weight"},
               "right": {"kind": "fact", "name": "breathlessness"}}
        facts["breathlessness"] = {"type": "boolean", "unit": None, "display_name": "Breathlessness",
                                   "valid_for": "7d", "valid_for_hours": 168, "required": True,
                                   "area": "symptom", "applicable_classifications": [],
                                   "applicable_phases": [], "extraction_hint": None}
        errors = parser.validate_expression(ast, facts)
        assert any("weight" in e for e in errors)

    def test_ordering_op_on_categorical_fact_is_rejected(self):
        facts = self._facts(mood="categorical")
        ast = parser.parse_expression("mood > 3")
        errors = parser.validate_expression(ast, facts)
        assert len(errors) >= 1
        assert any("mood" in e for e in errors)

    def test_categorical_equality_is_accepted(self):
        facts = self._facts(mood="categorical")
        ast = parser.parse_expression("mood == 'low'")
        errors = parser.validate_expression(ast, facts)
        assert errors == []

    def test_delta_on_non_number_fact_is_rejected(self):
        facts = self._facts(breathlessness="boolean")
        ast = parser.parse_expression("delta(breathlessness, 48h) >= 2")
        errors = parser.validate_expression(ast, facts)
        assert len(errors) >= 1
        assert any("breathlessness" in e for e in errors)

    def test_sum_on_non_number_fact_is_rejected(self):
        facts = self._facts(breathlessness="boolean")
        ast = parser.parse_expression("sum(breathlessness, 7d) >= 3")
        errors = parser.validate_expression(ast, facts)
        assert len(errors) >= 1

    def test_persists_with_boolean_fact_is_accepted(self):
        """persists(breathlessness, 3, 7d) is valid — spec §5.5 explicitly exempts persists from number-only."""
        facts = self._facts(breathlessness="boolean")
        ast = parser.parse_expression("persists(breathlessness, 3, 7d)")
        errors = parser.validate_expression(ast, facts)
        assert errors == []

    def test_persists_with_number_comparison_is_accepted(self):
        facts = self._facts(weight="number")
        ast = parser.parse_expression("persists(weight >= 80, 3, 7d)")
        errors = parser.validate_expression(ast, facts)
        assert errors == []

    def test_count_and_no_reading_accept_any_type(self):
        """count and no_reading work on any type — they count recordings, not values."""
        facts = self._facts(breathlessness="boolean", weight="number")
        ast_count = parser.parse_expression("count(breathlessness, 7d) >= 3")
        ast_no_reading = parser.parse_expression("no_reading(weight, 7d)")
        assert parser.validate_expression(ast_count, facts) == []
        assert parser.validate_expression(ast_no_reading, facts) == []

    def test_persists_with_non_boolean_bare_fact_is_rejected(self):
        """persists() with a bare number fact must be rejected — only boolean facts are valid bare refs."""
        facts = self._facts(weight="number")
        ast = parser.parse_expression("persists(weight, 3, 7d)")
        errors = parser.validate_expression(ast, facts)
        assert len(errors) >= 1
        assert any("weight" in e for e in errors)

    def test_n_of_with_non_boolean_bare_fact_is_rejected(self):
        """n_of() bare identifiers are bool_identifiers per the grammar — number facts must be rejected."""
        facts = self._facts(weight="number", breathlessness="boolean")
        ast = parser.parse_expression("n_of(2, [weight, breathlessness])")
        errors = parser.validate_expression(ast, facts)
        assert len(errors) >= 1
        assert any("weight" in e for e in errors)

    def test_n_of_with_boolean_bare_facts_is_accepted(self):
        facts = self._facts(breathlessness="boolean", oedema="boolean")
        ast = parser.parse_expression("n_of(1, [breathlessness, oedema])")
        assert parser.validate_expression(ast, facts) == []
