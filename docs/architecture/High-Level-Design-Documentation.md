🚀 REAN Voice Agent – Implementation Master Prompt

We are building a voice-based AI nurse agent for REAN Foundation that can:

Make outbound follow-up calls (primary focus)

Receive inbound calls (phase 2)

Operate in major Indian languages initially

Later expand globally (Hausa, Swahili, etc.)

Work for low-literacy, feature-phone users

Integrate with our existing text-based REAN AI agent

We are piloting in India first using local telephony providers such as Exotel, with optional future global use of Twilio.

Your task is to generate a production-ready implementation plan including architecture, APIs, data models, and engineering tickets.

1️⃣ Core Design Principles

Voice is an interface layer, not a new intelligence layer.

Our existing REAN AI agent (LLM + RAG + workflows) remains the clinical brain.

STT, TTS, and telephony must be modular and replaceable.

Locale must be a first-class system concept.

Clinical logic must remain language-agnostic internally.

Escalation to human nurse must always be available.

System must be scalable across countries without architectural rewrite.

2️⃣ High-Level Architecture

Design a layered architecture:

Layer 1 – Telephony

Outbound and inbound call handling

Audio streaming support

Call status callbacks

Recording

SMS support

Use adapter pattern:

TelephonyProvider interface

ExotelAdapter

TwilioAdapter (future)

Layer 2 – Speech Layer

Abstract interfaces:

ASRProvider:

transcribe(audio, locale, hints)

TTSProvider:

synthesize(text, locale, voice_profile)

Speech providers must be pluggable.

Layer 3 – Voice Orchestrator (New Service)

Responsibilities:

Session management

Turn-taking control

Silence detection

Timeout handling

Retry logic

Guardrails

Language detection + confirmation

Convert transcripts → structured clinical events

Send structured input to REAN AI agent

Receive response

Send response to TTS

Trigger escalation

Layer 4 – REAN AI Agent (Existing)

RAG

Clinical workflows

Risk scoring

Escalation logic

Canonical event generation

3️⃣ Clinical Logic Model (Language-Agnostic)

Define canonical structured events:

Example:

SYMPTOM_CHECK{fever:true, severe_pain:false}

MED_ADHERENCE{taken_today:false}

RISK_SCORE=HIGH

ESCALATE=true

All clinical reasoning operates on canonical events.
Language is only for input/output.

4️⃣ Locale-First Design

Create a Locale object:

Fields:

locale_code (hi-IN, te-IN, sw-KE, ha-NG)

region

script

default_voice_profile

medical_lexicon

escalation_phrases

consent_script

fallback_language

Every call session must include locale.

5️⃣ Language Pack System

Each locale must include:

System prompts

Structured nurse scripts

Consent statements

Symptom question variants

Medical synonym mapping

Digit/number pronunciation rules

Escalation messaging

Adding a new language must require:

Adding a new language pack

Validating STT accuracy

No core code rewrite

6️⃣ Pilot Scope (India)

Phase 1:

Outbound only

3-minute structured calls

Use cases:

Post-surgery follow-up

Medication adherence check

Missed appointment reminder

Phase 2:

Controlled inbound

Intent-based routing

Human fallback

7️⃣ Non-Functional Requirements

Latency:

<2 seconds turn response

Reliability:

Graceful retry on silence

Drop detection

Idempotent call handling

Compliance:

Consent capture

Call recording policy

Data localization

Audit logs

Security:

Encrypted audio streams

Secure webhook validation

Role-based dashboard access

8️⃣ Telecom Strategy

Use best local provider per country.

Maintain adapter abstraction.

No vendor lock-in.

TelephonyProvider must be swappable without refactor.

9️⃣ Evaluation Framework

Build automated evaluation harness:

Per language:

STT word error rate

Slot extraction accuracy

Clinical event accuracy

Task completion rate

Escalation accuracy

Must support future Hausa and Swahili validation.

🔟 Engineering Deliverables Required

Generate:

Detailed system architecture diagram (textual description)

API contract definitions

Data model schemas

Call session state machine

Adapter interface definitions

Language pack structure spec

Risk & escalation workflow

Observability & metrics design

90-day engineering roadmap

Epics + granular tickets

Constraints

Must support feature phones (audio-only)

Must scale to 100,000+ calls/month

Must support multi-country expansion without redesign

Must isolate telephony vendor logic

Must isolate speech vendor logic

Must support additional global languages

Output Expectation

Produce:

Technical architecture spec

Implementation-ready interface definitions

Structured engineering plan

Production deployment considerations

Future-proofing checklist

Do not provide high-level marketing content.
Provide implementation-level detail suitable for senior backend engineers.