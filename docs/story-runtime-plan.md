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
  -> Build runtime context
  -> Ask AI for narrative + proposed events
  -> Validate proposed events
  -> Update session state
  -> Return narrative + updated visible state
```

The AI should not be the only source of truth. It can propose what happens, but the server decides what is accepted.

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

The AI should produce two things:

1. Narrative response for the player.
2. Proposed runtime events.

The platform should:

- validate whether the event type is allowed
- validate whether the payload is reasonable
- reject impossible changes
- persist accepted state changes
- pass updated state into the next AI call

This keeps the AI creative, but prevents it from silently rewriting the game.

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

Step 1: Define runtime types

- Create TypeScript types for state, events, and AI response.
- Verify with typecheck.

Step 2: Add session runtime persistence

- Add runtime state fields to conversation.
- Add migration.
- Verify creating and loading sessions still works.

Step 3: Add runtime state initialization

- When starting a world, create initial state from world metadata.
- Verify a new session has scene, objective, clues, and inventory defaults.

Step 4: Add AI response contract

- Update chat API to request narrative plus events.
- Parse and validate the result.
- Fall back gracefully if AI returns plain text.

Step 5: Add event reducer

- Implement simple event handlers.
- Verify each supported event updates state correctly.

Step 6: Update play UI

- Show runtime state in chat page.
- Add quick actions.
- Verify desktop and mobile layouts.

Step 7: Creator support

- Add fields for initial scene, objective, clues, items, and endings.
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

Start with the smallest technical foundation:

1. Add runtime TypeScript types.
2. Add a `runtimeState` field to conversations.
3. Initialize state when a new session starts.

After that, connect AI event output.
