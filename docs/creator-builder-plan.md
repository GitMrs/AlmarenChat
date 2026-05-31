# Creator Builder Plan

## 1. Goal

Upgrade the current Agent creation flow into an AI-assisted creator builder for playable entertainment content.

The old creation model is:

> create an AI assistant with a prompt

The new creation model should be:

> describe a concept, let AI help you build a playable experience step by step

The builder should help users create content that can be used by the Story Runtime later.

## 2. Why The Current Agent Builder Is Not Enough

The current builder is useful for assistant-style agents, but entertainment content needs more structure.

Missing pieces:

- playable objective
- player role
- opening scene
- world rules
- scenes
- clues
- items
- characters
- endings
- test play flow
- publish status

Without these, every created Agent is still just a prompt wrapper, not a reusable game or story template.

## 3. Product Direction

The creation entry should become a "Create Experience" flow with AI assistance.

Creators should not need to fill every field manually. Instead:

1. Creator writes a brief concept
2. AI generates structured content step by step
3. Creator reviews, edits, and confirms each step
4. System saves structured data for runtime use

Recommended creation types:

- Character
- Story World
- Mystery Case
- Interactive Script

Short-term UI can still live under the current `/create-agent` route, but user-facing language should move away from Agent.

## 4. Creation Types

### Character

Use when the creator wants to build a single role or NPC.

Fields:

- name
- avatar
- genre
- character identity
- personality
- speaking style
- relationship to player
- boundaries
- greeting
- example dialogue

Runtime relevance:

- can be used inside a story world
- can be chatted with directly
- can become an NPC in future multi-character rooms

### Story World

Use when the creator wants to build a broad playable setting.

Fields:

- title
- genre
- hook
- world setting
- player role
- opening scene
- main objective
- key locations
- key characters
- world rules
- possible endings

Runtime relevance:

- initializes scene, objective, and summary
- provides stable context to AI
- supports long-running sessions

### Mystery Case

Use when the creator wants a structured reasoning game.

Fields:

- case title
- case hook
- incident background
- crime scene
- victim or core problem
- suspects
- clues
- red herrings
- hidden truth
- solution condition
- fail condition

Runtime relevance:

- clues become runtime state
- suspects become inspectable characters
- hidden truth should not be exposed directly to the player
- ending is determined by accusation or solution event

### Interactive Script

Use when the creator wants a short branching story.

Fields:

- title
- genre
- premise
- chapters or scenes
- key choices
- trigger events
- endings
- estimated duration

Runtime relevance:

- good for short sessions
- supports quick actions and choices
- easier to validate than open-ended worlds

## 5. AI-Assisted Creation

### Core Principle

The creator AI is a helper, not the author. The creator always has final control.

- Creator provides the concept and direction
- AI generates structured content for review
- Creator edits, confirms, or regenerates each piece
- Only confirmed content is saved

### Creation AI vs Play AI

Creation AI and Play AI are two separate channels:

| | Creation AI | Play AI |
|---|---|---|
| Role | Creative assistant | Story character |
| Input | Creator's concept + existing fields | Player's action + game state |
| Output | Structured JSON | Narrative text |
| Purpose | Fill builder fields | Drive gameplay |
| Prompt | Builder-specific template | Runtime-specific template |
| Model | Can use a different model | Uses configured model |

### Step-by-Step Generation

Content is generated in steps, not all at once. Each step:

1. System sends existing context + current step prompt to AI
2. AI returns structured JSON
3. Frontend parses and fills the form fields
4. Creator reviews, edits, or requests regeneration
5. Creator confirms the step
6. System saves and proceeds to next step

Benefits:

- Each step is fast (smaller output)
- Creator can review incrementally
- Creator can edit between steps, and AI uses updated context
- Creator can skip steps or go back
- No overwhelming wall of generated content

### Generation Flows by Type

#### Mystery Case Generation

```
Step 1: Concept
  Creator input: one-line concept (e.g., "密室谋杀案，所有人都是朋友")
  AI output:
    - 3-5 suspects (name, role, brief motive)
    - core trick direction
  Creator: review, add/remove suspects, adjust motives

Step 2: Clues
  Context: confirmed suspects + concept
  AI output:
    - 6-10 clues (name, description, public/hidden)
    - 2-3 red herrings
  Creator: review, mark clue visibility, add details

Step 3: Truth & Endings
  Context: confirmed suspects + clues
  AI output:
    - killer identity and method
    - hidden truth narrative
    - solution condition
    - 2-3 ending branches (solved, wrong accusation, time out, etc.)
  Creator: review, adjust truth logic

Step 4: Scene & Opening
  Context: all confirmed content
  AI output:
    - opening scene description
    - crime scene details
    - greeting message
    - generated systemPrompt for runtime
  Creator: review final output
```

#### Story World Generation

```
Step 1: Concept
  Creator input: one-line concept
  AI output:
    - world title suggestion
    - genre and tone
    - hook line
    - 2-3 key locations
  Creator: review and adjust

Step 2: Characters & Rules
  Context: confirmed world concept
  AI output:
    - 3-5 key characters (name, role, brief description)
    - world rules (3-5 rules)
    - player role suggestion
  Creator: review, edit characters

Step 3: Story & Objective
  Context: confirmed world + characters
  AI output:
    - main objective
    - opening scene
    - 2-3 possible endings
    - greeting message
    - generated systemPrompt for runtime
  Creator: review final output
```

#### Character Generation

```
Step 1: Concept
  Creator input: character concept (e.g., "一个神秘的古董店老板")
  AI output:
    - name suggestion
    - identity and background
    - personality traits
    - speaking style
  Creator: review and adjust

Step 2: Details
  Context: confirmed character concept
  AI output:
    - relationship to player
    - boundaries (what the character won't do)
    - greeting message
    - 2-3 example dialogues
    - generated systemPrompt for runtime
  Creator: review final output
```

#### Interactive Script Generation

```
Step 1: Concept
  Creator input: one-line premise
  AI output:
    - title suggestion
    - genre and tone
    - first scene description
    - estimated duration
  Creator: review and adjust

Step 2: Branches
  Context: confirmed premise
  AI output:
    - 3-5 key choices with consequences
    - 2-3 trigger events
    - 2-3 ending branches
  Creator: review, adjust branches

Step 3: Opening
  Context: all confirmed content
  AI output:
    - greeting message
    - generated systemPrompt for runtime
  Creator: review final output
```

### Prompt Template Structure

Each generation step uses a structured prompt:

```
[system]
You are a creative assistant helping build interactive entertainment content.
Output valid JSON only. No markdown, no explanation.

[context]
Creation type: mystery_case
Confirmed data so far:
  concept: "密室谋杀案，所有人都是朋友"
  suspects: [...]  (from previous step)

[current step]
Generate suspects for this mystery case.
Output format:
{
  "suspects": [
    { "name": "", "role": "", "motive": "", "secret": "" }
  ],
  "coreTrick": ""
}
```

Key rules:

- AI always returns valid JSON
- Creator text is separated from system rules
- Hidden truth is generated but marked as runtime-only
- Each step prompt includes all confirmed context from previous steps
- Creator can manually edit between steps, and edits are included in context

## 6. Builder Flow

### Step 1: Choose Type

Show four creation cards:

- Character
- Story World
- Mystery Case
- Interactive Script

Each card should explain what it creates and how it is played.

### Step 2: Basic Info

Shared fields (can be filled manually or AI-suggested):

- title / name
- genre
- avatar
- short hook
- visibility

### Step 3: AI Generation

Based on type, run the step-by-step generation flow:

- Creator writes a concept line
- AI generates the first batch of structured content
- Creator reviews, edits, confirms or regenerates
- Repeat for each step

Creator can also skip AI and fill everything manually.

### Step 4: Runtime Settings

Auto-generated from the structured content:

- initial scene (from opening scene)
- initial objective (from main objective)
- starting clues (from clue list)
- hidden facts (from truth / secrets)

Creator can override these manually.

### Step 5: Test Play

Before publishing, creators should be able to test the experience.

Actions:

- start test session
- view generated prompt context
- inspect runtime state
- reset test session

### Step 6: Publish

Publishing should be separate from saving.

Statuses:

- draft
- testing
- published
- archived

Short-term, this can map to existing `isPublic`.

Future:

- add review status
- add admin moderation
- add versioning

## 7. Data Model Direction

Short-term:

- Continue using `Agent` as the storage model.
- Add entertainment metadata fields gradually.
- Store complex builder data as JSON if needed.

Recommended short-term fields:

```text
Agent
  creationType String?        // character | world | mystery | script
  hook String?
  worldSetting String?
  playerRole String?
  openingScene String?
  rules String?
  winConditions String?
  estimatedDuration String?
  difficulty String?
  playerCount String?
  tags Json/String?
  builderConfig Json/String?
```

Future models:

```text
Experience
Character
Scene
Clue
Item
Ending
ExperienceVersion
```

Do not migrate everything at once. Use the current Agent model until the product shape is proven.

## 8. Builder Config

For V1, use a flexible `builderConfig` object to store type-specific data.

Example for Mystery Case:

```json
{
  "type": "mystery",
  "case": {
    "incident": "A sealed letter disappeared during a dinner party.",
    "crimeScene": "Old manor library",
    "truth": "The butler hid the letter inside the fireplace clock"
  },
  "suspects": [
    { "id": "butler", "name": "Butler", "motive": "Protect the family secret", "secret": "Is the old master's illegitimate son" }
  ],
  "clues": [
    { "id": "mud", "name": "Muddy Footprint", "description": "...", "visibility": "public" },
    { "id": "clock", "name": "Fireplace Clock", "description": "...", "visibility": "hidden" }
  ],
  "redHerrings": [
    { "id": "glove", "name": "Lost Glove", "description": "Found near the library, belongs to the maid" }
  ],
  "endings": [
    { "id": "solved", "name": "Case Solved", "condition": "Correct accusation with evidence" },
    { "id": "wrong_accusation", "name": "Wrong Accusation", "condition": "Accuse wrong suspect" }
  ]
}
```

## 9. Prompt Generation

The system composes the runtime prompt from structured data, not from a single user-written prompt.

Prompt sections:

- identity
- world / character setup
- player role
- current scene
- rules
- hidden facts
- runtime state
- response contract

Important:

- hidden truth should be passed to AI but not displayed to player
- runtime state should override stale narrative memory
- creator text should be separated from system rules

## 10. UI Direction

The builder should feel like creating a playable experience, not filling a technical form.

Recommended UI:

- type cards at the top
- concept input with "Generate" button
- step-by-step generation with review cards
- inline editing of generated content
- regenerate button per step
- live preview card on the side
- test play button always visible on desktop
- save draft and publish as separate actions

Mobile:

- single-column sections
- sticky bottom save/test controls
- preview collapsed by default

Avoid:

- one long prompt textarea as the primary interface
- too many advanced options in V1
- making users understand runtime internals
- forcing users to fill every field manually

## 11. V1 Scope

V1 should support:

- choose creation type
- AI-assisted step-by-step generation (Mystery Case first)
- manual editing of AI-generated content
- shared basic fields
- type-specific setup fields
- draft save
- publish / unpublish
- test play
- runtime initial state generation

V1 can skip:

- version history
- collaborative editing
- advanced scene graph editor
- monetization settings
- asset library
- moderation queue

## 12. Implementation Order

Step 1: Planning and terminology

- Rename UI language from Agent creation to experience creation.
- Keep route and backend names if needed.

Step 2: Add creation type

- Add a `creationType` field or equivalent metadata.
- Update create form to select type first.

Step 3: Restructure create page

- Type selection
- Basic Info
- AI Generation (step by step)
- Preview

Step 4: Add creation AI API

- New `/api/create` endpoint (separate from `/api/chat`)
- Accepts creation type, step index, existing context
- Returns structured JSON
- Uses a builder-specific prompt template

Step 5: Implement Mystery Case builder

- Step 1: concept → suspects + core trick
- Step 2: suspects → clues + red herrings
- Step 3: clues → truth + endings
- Step 4: all → opening + systemPrompt
- Each step: generate, parse JSON, fill form, review, confirm

Step 6: Save metadata

- Save structured fields into existing Agent fields and builder config.
- Verify existing agents still load.

Step 7: Add test play

- Allow creator to start a private test session.
- Use the same runtime initialization as normal play.

Step 8: Publish flow

- Separate draft saving from publishing.
- Keep existing public/private behavior for now.

Step 9: Runtime integration

- Use builder fields to initialize Story Runtime state.
- Show created clues, objectives, and scenes in play UI.

Step 10: Expand to other types

- Story World builder
- Character builder
- Interactive Script builder

## 13. Success Criteria

The builder is successful when:

- A creator can describe a concept in one line and get a playable mystery case through AI generation.
- A creator can review, edit, and regenerate each step of the content.
- Generated content is structured JSON, not free-form text.
- Created experiences can initialize runtime state.
- Draft and publish flows are understandable.
- Existing Agent-based content still works.
- The UI feels entertainment-first, not productivity-first.

## 14. Recommended First Step

Start with Mystery Case + AI generation.

Reason:

- clear rules, natural structure
- AI generation is most valuable here (suspects, clues, truth are hard to write from scratch)
- structured output is easiest to validate
- good fit for runtime state
- easier to test than open-ended roleplay

Implementation order:

1. Add `/api/create` endpoint with Mystery Case prompt template
2. Add creation type selector to `/create-agent`
3. Build step-by-step generation UI for Mystery Case
4. Connect to existing Agent save flow
5. Test play with generated systemPrompt
6. Expand to other types
