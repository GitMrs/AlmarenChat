# Story Runtime Plan

## 1. Goal

Build a lightweight interactive story runtime for AI-powered entertainment experiences.

This is not a full game engine. The first version should solve one core problem:

> AI writes the story, but the platform owns the rules, state, progress, and endings.

The runtime should make stories more stable, replayable, and maintainable without removing the flexibility of AI narration.

## 2. Why We Need It

If every game is only an AI chat, the product will be hard to control later.

Risks of AI-only gameplay:

- Rules may change during a session.
- Clues, inventory, relationship values, and progress can be forgotten.
- Win / lose conditions are hard to verify.
- Different sessions of the same world are inconsistent.
- Admin, analytics, quota, ranking, and paid features become hard to build.
- Creators cannot reliably design a playable loop.

The runtime gives us a stable layer between the user and the AI.

## 3. Runtime Model

Recommended flow:

```text
User input
  -> Parse intent
  -> Match intent against current scene actions
  -> Engine validates conditions
  -> Engine applies effects
  -> AI narrates engine-approved result
  -> Return narrative + updated visible state + next actions
```

The AI should not be the source of truth. The engine owns what happens. AI can help parse free-form input and narrate results, but the server decides the action, effects, and ending.

The runtime depends on a generated and confirmed blueprint from the creator builder. If the blueprint is weak, runtime cannot be stable. For that reason, the first engine work should be paired with builder work that produces scenes, actions, conditions, effects, clues, and endings as structured data.

Target flow:

```text
Generated blueprint
  -> Initialize session state
  -> Player chooses or describes an action
  -> Engine resolves the action
  -> AI renders the result without changing facts
```

## 4. Core Concepts

### World

The playable entity. It can still use the current `Agent` model internally for now.

World fields:

- title
- genre
- hook
- world setting
- opening scene
- player role
- rules
- win / ending conditions
- initial state
- available scenes
- important characters
- possible clues or items

### Play Session

A user's current run inside a world.

This can extend the current `Conversation`.

Session fields:

- world id
- user id
- current scene
- current objective
- progress status
- visible summary
- runtime state
- ending reached or not

### Runtime State

Structured JSON owned by the platform.

Example:

```json
{
  "sceneId": "library",
  "objective": "Find out who stole the sealed letter",
  "flags": {
    "met_butler": true,
    "opened_safe": false
  },
  "clues": [
    { "id": "muddy_footprint", "name": "Muddy Footprint", "discovered": true }
  ],
  "inventory": [
    { "id": "brass_key", "name": "Brass Key" }
  ],
  "relationships": {
    "butler": 12,
    "heiress": -4
  },
  "stats": {
    "health": 100,
    "stress": 20,
    "time": 3
  }
}
```

### Runtime Event

An event is a structured change requested by AI or triggered by user action.

Examples:

- `scene.change`
- `clue.discover`
- `item.add`
- `item.remove`
- `relationship.change`
- `stat.change`
- `objective.update`
- `ending.reach`

Example:

```json
{
  "type": "clue.discover",
  "payload": {
    "id": "muddy_footprint",
    "name": "Muddy Footprint"
  }
}
```

## 5. AI Boundary

The AI should be downgraded from game master to assistant.

Allowed AI responsibilities:

- parse free-form player text into candidate intent and target
- narrate engine-approved outcomes
- vary tone, dialogue, and atmosphere
- help creators draft or improve blueprint content before publish

Disallowed AI responsibilities:

- invent new clues during play
- mark clues as discovered without an engine action
- change the killer, hidden truth, or ending conditions
- move the player to a scene that the engine did not select
- grant items or flags without an engine effect
- skip required conditions because the narration feels dramatic

Old AI-first contract:

1. Narrative response for the player.
2. Proposed runtime events.

This can still be used as a temporary bridge, but the long-term contract should be engine-first.

Engine-first contract:

1. Engine receives a structured action.
2. Engine returns an action result.
3. AI narrates that result.

Example action result:

```json
{
  "actionId": "inspect_door_lock",
  "allowed": true,
  "result": "discovered_clue",
  "effects": [
    { "type": "clue.discover", "clueId": "door_lock_scratch" }
  ],
  "visibleFacts": [
    "There is a thin scratch inside the lock."
  ],
  "nextActions": [
    "Inspect the desk",
    "Question the butler",
    "Check the window"
  ]
}
```

The platform should:

- validate whether the event type is allowed
- validate whether the payload is reasonable
- reject impossible changes
- persist accepted state changes
- pass updated state into the next AI call

In the final design, most events should be created by the engine rather than proposed by AI. This keeps the AI creative, but prevents it from silently rewriting the game.

## 6. Minimal V1 Scope

V1 should support only a small set of state features.

Must have:

- current scene
- current objective
- session summary
- discovered clues
- inventory items
- ending reached

Nice to have:

- relationship values
- simple numeric stats
- quick action choices

Do not build in V1:

- realtime multiplayer
- physics
- complex combat
- visual map editor
- full scripting language
- achievement system
- economy or payment rules

## 7. Database Direction

Keep the current models where possible.

Recommended first step:

- Keep `Agent` as the world template.
- Keep `Conversation` as the play session.
- Add a JSON field for runtime state.

Possible future models:

- `World`
- `WorldScene`
- `WorldCharacter`
- `WorldItem`
- `WorldClue`
- `PlaySession`
- `PlayEvent`

Suggested incremental fields:

```text
Conversation
  runtimeState Json?
  runtimeSummary String?
  currentScene String?
  currentObjective String?
  endedAt DateTime?
  endingType String?
```

If Prisma JSON support is inconvenient for SQLite, store runtime state as a stringified JSON field first.

## 8. API Direction

Possible endpoints:

```text
POST /api/play/start
POST /api/play/:sessionId/message
GET  /api/play/:sessionId/state
POST /api/play/:sessionId/action
```

Short-term, we can keep `/api/chat` and evolve it internally.

Recommended first implementation:

- Add runtime state loading inside chat API.
- Include runtime state in the AI prompt.
- Ask AI to return narrative plus structured events.
- Parse events.
- Update conversation runtime state.
- Return both message and visible runtime state.

## 9. Prompt Contract

The AI should be instructed to return structured data.

Example response contract:

```json
{
  "narrative": "You kneel beside the window and notice a thin trail of mud...",
  "events": [
    {
      "type": "clue.discover",
      "payload": {
        "id": "muddy_footprint",
        "name": "Muddy Footprint"
      }
    }
  ],
  "suggestedActions": [
    "Question the butler",
    "Inspect the garden",
    "Open the desk drawer"
  ]
}
```

The user should only see the narrative and useful UI state. Raw JSON should not be shown in chat.

## 10. UI Direction

The chat page should become a play page.

Runtime UI modules:

- current scene
- current objective
- clue list
- inventory
- suggested actions
- progress / ending state

For mobile:

- collapse runtime details into a drawer
- keep current objective visible near the top
- show quick actions above the input

For desktop:

- keep runtime panel on the side
- show clues and inventory as compact lists
- keep chat as the main interaction area

## 11. Implementation Order

Step 1: Accept builder blueprint

- Create TypeScript types for blueprint, state, action, condition, effect, and engine result.
- Verify a generated Mystery Case blueprint can be loaded.

Step 2: Build pure engine reducer

- Input: blueprint + current state + action id.
- Output: allowed / blocked result, effects, next state, next actions.
- Verify it works without calling AI.

Step 3: Add session runtime persistence

- Add runtime state fields to conversation if missing.
- Store the selected blueprint snapshot for the session.
- Verify creating and loading sessions still works.

Step 4: Add runtime state initialization

- Initialize state from the blueprint initial state.
- Verify a new session has scene, objective, clues, and inventory defaults.

Step 5: Add action execution API

- Allow the client to submit a structured action id.
- Resolve the action through the engine.
- Persist accepted state changes.

Step 6: Add AI narration

- Send only engine-approved results to AI.
- Ask AI to narrate visible facts without changing them.
- Verify AI cannot introduce new clues or effects.

Step 7: Add free-form intent parsing

- Convert player text into candidate intent and target.
- Match candidate intent against current available actions.
- Ask for clarification when no action matches.

Step 8: Update play UI

- Show runtime state in chat page.
- Add quick actions.
- Verify desktop and mobile layouts.

Step 9: Creator support

- Add builder fields for scenes, actions, conditions, effects, and endings.
- Verify custom worlds can define playable setup.

## 12. Success Criteria

The runtime is successful when:

- A player can start the same world twice and get consistent initial state.
- Clues and items discovered during play persist.
- The current objective updates predictably.
- AI cannot accidentally erase the session state.
- The UI can show progress outside the chat messages.
- A creator can design a simple playable loop without writing code.

## 13. Recommended Next Step

Start with the smallest generation-to-engine foundation:

1. Define Mystery Case blueprint types.
2. Generate or hand-write one tiny blueprint.
3. Build a pure reducer that executes blueprint actions.

After that, connect AI narration. Free-form input parsing can wait until fixed actions work.
