#!/usr/bin/env python3
"""Self-invalidation for the Python <-> TypeScript contract fixture.

tests/fixtures/kb-sample.xlsx is a small hand-authored sample KB (3 rules,
each with a FIRES and a NOT_FIRES Sheet-10 case). Its parser output is
committed as src/decision/__tests__/fixtures/kb-sample.json and exercised
end-to-end by src/decision/__tests__/kb-contract.test.ts.

A frozen fixture only catches drift on the day it was generated -- if a
future change to generate-knowledge-graph.py's field names or shapes isn't
matched by a regeneration of the committed JSON, both the Python suite and
the Jest suite would stay green while production broke (Python only
exercises the parser directly; Jest only exercises the shape it was given).

This test re-emits the workbook fresh and asserts the result matches the
committed JSON structurally (ignoring meta.generated_at, which is a
timestamp and expected to differ on every run). If it fails, regenerate the
fixture with scripts/kg-tools/regen-kb-fixture.sh.
"""
import copy
import importlib.util
import json
import os

import pytest


def load_parser():
    script_path = os.path.join(os.path.dirname(__file__), "../../../scripts/generate-knowledge-graph.py")
    spec = importlib.util.spec_from_file_location("parser", os.path.abspath(script_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


parser = load_parser()

XLSX_PATH = os.path.join(os.path.dirname(__file__), "../../fixtures/kb-sample.xlsx")
JSON_FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "../../../src/decision/__tests__/fixtures/kb-sample.json"
)


def _strip_volatile(result: dict) -> dict:
    """Remove fields that are expected to differ between runs (timestamps)."""
    result = copy.deepcopy(result)
    kg = result.get("knowledge_graph")
    if kg and "meta" in kg and "generated_at" in kg["meta"]:
        del kg["meta"]["generated_at"]
    return result


class TestKbSampleFixtureIsFresh:
    def test_xlsx_fixture_exists(self):
        assert os.path.isfile(XLSX_PATH), (
            f"tests/fixtures/kb-sample.xlsx not found at {XLSX_PATH}. "
            f"This is the committed sample workbook Task 6's runner tests are built on."
        )

    def test_committed_json_fixture_exists(self):
        assert os.path.isfile(JSON_FIXTURE_PATH), (
            f"src/decision/__tests__/fixtures/kb-sample.json not found. "
            f"Regenerate with scripts/kg-tools/regen-kb-fixture.sh."
        )

    def test_fresh_parse_matches_committed_fixture(self):
        """The whole point of this test: re-parse the committed xlsx and diff
        against the committed JSON. A field rename, a shape change, or any
        other drift in generate-knowledge-graph.py's output surfaces here."""
        fresh = parser.parse_xlsx(XLSX_PATH)
        assert fresh["valid"] is True, (
            f"kb-sample.xlsx no longer parses as valid: {fresh['errors']}"
        )

        with open(JSON_FIXTURE_PATH, "r", encoding="utf-8") as f:
            committed = json.load(f)

        assert _strip_volatile(fresh) == _strip_volatile(committed), (
            "The committed fixture (src/decision/__tests__/fixtures/kb-sample.json) "
            "no longer matches fresh parser output for tests/fixtures/kb-sample.xlsx. "
            "Regenerate it with scripts/kg-tools/regen-kb-fixture.sh."
        )

    def test_fixture_covers_multiple_rules_with_both_fires_and_not_fires(self):
        """Guards against someone shrinking the fixture back down to the
        single-rule case make_full_valid_workbook_with_uncovered_rule() builds
        -- Task 6 explicitly requires multiple rules with both outcomes for a
        meaningful contract test."""
        with open(JSON_FIXTURE_PATH, "r", encoding="utf-8") as f:
            committed = json.load(f)
        kg = committed["knowledge_graph"]

        rule_ids = {r["rule_id"] for r in kg["rules"]}
        assert len(rule_ids) >= 2, "Fixture must exercise multiple rules."

        expects_by_rule = {}
        for t in kg["rule_tests"]:
            expects_by_rule.setdefault(t["rule_id"], set()).add(t["expect"])

        for rule_id in rule_ids:
            assert expects_by_rule.get(rule_id) == {"FIRES", "NOT_FIRES"}, (
                f"Rule '{rule_id}' must have both a FIRES and a NOT_FIRES case in the fixture."
            )
