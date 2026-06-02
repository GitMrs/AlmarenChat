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
- world notes
- skill cards

Runtime relevance:

- can be used inside a story world
- can be chatted with directly
- can become an NPC in future multi-character rooms

### Roleplay Assets

Character creation should move toward asset-based authoring instead of one large prompt.

Short-term asset layers:

- Character card: identity, personality, speaking style, scenario, relationship, boundaries.
- World notes: stable facts the character knows, such as locations, organizations, backstory, secrets, and recurring topics.
- Skill cards: no-code behavior recipes that describe what the character can do when the user asks for a specific interaction.
- Prompt preview: the final runtime prompt composed from confirmed assets, editable before publish.

Skill cards are not executable plugins in V1. They are prompt assets.

Example skill card:

```json
{
  "name": "塔罗占卜",
  "trigger": "当用户询问运势、抽牌、选择牌阵时",
  "instruction": "先让用户选择牌阵或抽牌数量，再用角色口吻解释牌意。",
  "boundaries": "不要把占卜说成确定命运，不要替用户做重大决定。",
  "example": "你可以先选三张牌：过去、现在、可能的方向。"
}
```

Why start with no-code skill cards:

- much safer than arbitrary JS plugins
- easy for creators to understand and edit
- directly improves roleplay quality
- can later become the schema for real tools or plugins

Do not build in this phase:

- plugin marketplace
- executable JavaScript plugins
- permission prompts
- sandboxing
- external API tools
- skill runtime dispatch beyond prompt composition

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

### Generation-First Engine Strategy

The next phase should start from generation, not from runtime chat.

Reason:

- A text game engine is only stable when the playable blueprint is stable.
- Runtime prompts cannot reliably repair a weak story structure.
- If clues, scenes, actions, and endings are generated as loose prose, the engine has nothing firm to execute.
- If the builder produces structured game data first, runtime can become a rule executor instead of an AI improvisation loop.

Goal:

> The builder should generate an executable game blueprint. The runtime engine should execute that blueprint. AI should assist with wording, parsing, and authoring, but not own the main game flow.

This means the builder must produce more than a `systemPrompt`.

For each playable experience, generation should create:

- scenes
- interactable objects
- available actions
- action conditions
- action effects
- clues
- items
- NPCs
- hidden truth
- ending conditions
- initial state
- suggested fallback actions

The generated `systemPrompt` becomes secondary. It is useful for AI narration, but it should not be the source of truth.

### Blueprint Before Prompt

Current risk:

```text
Creator concept
  -> AI generates a long systemPrompt
  -> Chat runtime asks AI to keep the game consistent
```

Target flow:

```text
Creator concept
  -> AI generates structured blueprint
  -> Creator reviews and confirms blueprint
  -> Runtime initializes engine state from blueprint
  -> Player actions are resolved by engine
  -> AI narrates engine-approved results
```

The prompt should be composed from confirmed blueprint data, not hand-written as the primary artifact.

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

Step 5: Playable Blueprint
  Context: confirmed suspects + clues + truth + opening
  AI output:
    - scene list
    - interactable objects per scene
    - allowed actions per object
    - conditions for locked actions
    - effects produced by each action
    - accusation / solution actions
    - ending triggers
    - initial engine state
  Creator: review whether the case can actually be played from start to finish
```

For Mystery Case V1, Step 5 is the most important step for engine stability. It converts creative content into executable rules.

Example blueprint shape:

```json
{
  "initialState": {
    "sceneId": "study",
    "objective": "Investigate the sealed letter case",
    "flags": {},
    "discoveredClues": [],
    "inventory": []
  },
  "scenes": [
    {
      "id": "study",
      "name": "Study",
      "objects": [
        { "id": "door_lock", "name": "Door lock" },
        { "id": "desk", "name": "Desk" }
      ],
      "actions": [
        {
          "id": "inspect_door_lock",
          "label": "Inspect the door lock",
          "intent": "inspect",
          "target": "door_lock",
          "effects": [
            { "type": "clue.discover", "clueId": "door_lock_scratch" }
          ]
        }
      ]
    }
  ],
  "endings": [
    {
      "id": "solved",
      "condition": {
        "type": "accuse",
        "suspectId": "butler",
        "requiredClues": ["door_lock_scratch", "burned_letter"]
      }
    }
  ]
}
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

## 9A. Current Generation Gap Analysis

Current Mystery Case generation already covers useful creative material:

- suspects
- core trick
- clues
- red herrings
- truth
- solution condition
- endings
- opening scene
- crime scene
- greeting
- runtime system prompt

This is enough to create an AI chat experience, but not enough for an engine-driven text game.

Missing pieces for the engine:

- stable ids for every suspect, clue, scene, object, item, and ending
- scene graph
- interactable objects inside each scene
- action list for each scene or object
- action intent and target
- action conditions
- action effects
- clue discovery triggers
- NPC knowledge map
- accusation / solution action schema
- initial engine state
- blocked-action responses
- next-action suggestions based on engine state
- validation rules that prevent impossible cases

### What To Add First

The next generation upgrade should add one new final step for Mystery Case:

```text
Step 5: Playable Blueprint
```

Input:

- confirmed concept
- suspects
- core trick
- clues
- red herrings
- truth
- solution condition
- endings
- opening scene
- crime scene

Output:

```json
{
  "blueprintVersion": 1,
  "initialState": {},
  "scenes": [],
  "actions": [],
  "conditions": [],
  "effects": [],
  "accusation": {},
  "validationNotes": []
}
```

This should be saved inside `builderConfig.blueprint`.

### Required Blueprint Fields

Minimum V1 blueprint:

```json
{
  "blueprintVersion": 1,
  "initialState": {
    "sceneId": "crime_scene",
    "objective": "Investigate the case and identify the culprit",
    "flags": {},
    "discoveredClueIds": [],
    "inventoryItemIds": []
  },
  "scenes": [
    {
      "id": "crime_scene",
      "name": "Crime Scene",
      "description": "Visible description for the player.",
      "objectIds": ["door_lock", "desk"],
      "actionIds": ["inspect_door_lock", "inspect_desk"]
    }
  ],
  "objects": [
    {
      "id": "door_lock",
      "name": "Door Lock",
      "sceneId": "crime_scene",
      "description": "A visible object the player can inspect."
    }
  ],
  "actions": [
    {
      "id": "inspect_door_lock",
      "label": "Inspect the door lock",
      "intent": "inspect",
      "targetId": "door_lock",
      "conditions": [],
      "effects": [
        { "type": "clue.discover", "clueId": "door_lock_scratch" }
      ],
      "successText": "The player discovers a scratch inside the lock.",
      "blockedText": ""
    }
  ],
  "accusation": {
    "enabledWhen": [
      { "type": "hasClue", "clueId": "door_lock_scratch" }
    ],
    "correctSuspectId": "butler",
    "requiredClueIds": ["door_lock_scratch", "burned_letter"],
    "successEndingId": "solved",
    "failureEndingId": "wrong_accusation"
  }
}
```

### Generation Rules For Blueprint

The generation prompt should require:

- Every id must be stable, ASCII, lowercase, and unique.
- Every clue must have at least one discovery action.
- Every hidden clue must be gated by a condition or specific action.
- Every action must have a clear target.
- Every action effect must reference an existing clue, item, flag, scene, or ending.
- The correct ending must require the culprit plus key evidence.
- Wrong accusation must have a defined failure ending.
- Public clues can appear in initial state; hidden clues cannot.
- The generated blueprint must be playable from start to finish.

### Validation To Add After Generation

After AI returns the blueprint, the server should validate it before saving:

- duplicate ids
- missing references
- actions with no effects
- clues that are never discoverable
- endings that are never reachable
- accusation references an unknown suspect
- required clues do not exist
- initial scene does not exist
- hidden truth exposed in player-visible descriptions

Validation can start as a warning list in `validationNotes`. It does not need to block saving immediately, but publish should eventually require no critical validation errors.

### Current Code Touchpoints

Current implementation already has the right insertion points:

- `/api/create` has step-based generation prompts.
- `/create-agent` maps `sectionId` to generation step.
- Mystery builder data is saved into `builderConfig`.
- Runtime initialization already reads `builderConfig`.

Minimal code changes for generation-first work:

1. Add a new `blueprint` state in `/create-agent`.
2. Add a new Mystery builder section or button for `blueprint`.
3. Map `sectionId === 'blueprint'` to `/api/create` step `5`.
4. Add `MYSTERY_PROMPTS[5]` in `/api/create`.
5. Save returned blueprint as `builderConfig.blueprint`.
6. Load `config.blueprint` when editing an existing experience.
7. Show blueprint validation notes in the creator UI.

Do not change runtime behavior until one generated blueprint can be saved and inspected.

### Blueprint Generation Acceptance Criteria

The first blueprint generation pass is good enough when:

- one concept can produce a saved `builderConfig.blueprint`
- the blueprint has at least one scene
- the blueprint has at least three interactable objects
- each hidden clue has at least one discovery action
- every action references an existing object or NPC
- every effect references existing content
- there is one correct accusation path
- there is one wrong accusation path
- validation reports no missing references
- the blueprint can be executed manually by a pure reducer in a later step

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

Step 1: Define blueprint schema

- Define the minimum executable structure for Mystery Case.
- Include scenes, objects, actions, conditions, effects, clues, endings, and initial state.
- Verify the schema can represent one complete playable case.

Step 2: Update creation prompts around blueprint output

- Keep AI generation step-by-step.
- Add a final Playable Blueprint generation step.
- Make the generated `systemPrompt` secondary to the blueprint.
- Verify generated JSON can be parsed and saved.

Step 3: Planning and terminology

- Rename UI language from Agent creation to experience creation.
- Keep route and backend names if needed.

Step 4: Add creation type

- Add a `creationType` field or equivalent metadata.
- Update create form to select type first.

Step 5: Restructure create page

- Type selection
- Basic Info
- AI Generation (step by step)
- Preview

Step 6: Add creation AI API

- New `/api/create` endpoint (separate from `/api/chat`)
- Accepts creation type, step index, existing context
- Returns structured JSON
- Uses a builder-specific prompt template

Step 7: Implement Mystery Case builder

- Step 1: concept -> suspects + core trick
- Step 2: suspects -> clues + red herrings
- Step 3: clues -> truth + endings
- Step 4: all -> opening + systemPrompt
- Step 5: all -> playable blueprint
- Each step: generate, parse JSON, fill form, review, confirm

Step 8: Save metadata

- Save structured fields into existing Agent fields and builder config.
- Verify existing agents still load.

Step 9: Add test play

- Allow creator to start a private test session.
- Use the same runtime initialization as normal play.

Step 10: Publish flow

- Separate draft saving from publishing.
- Keep existing public/private behavior for now.

Step 11: Runtime integration

- Use builder fields to initialize Story Runtime state.
- Show created clues, objectives, and scenes in play UI.

Step 12: Expand to other types

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

Start with Mystery Case blueprint generation.

Reason:

- clear rules, natural structure
- AI generation is most valuable here (suspects, clues, truth are hard to write from scratch)
- structured output is easiest to validate
- good fit for runtime state
- easier to test than open-ended roleplay
- gives the future text game engine something firm to execute

Implementation order:

1. Define Mystery Case blueprint schema
2. Update `/api/create` prompts to generate the blueprint as the final step
3. Save the blueprint inside `builderConfig`
4. Build a tiny engine that can execute blueprint actions without AI
5. Add AI narration after engine execution
6. Expand to other creation types only after the first case is playable
