# Story Engine Example

This document describes the smallest manual test case for the blueprint engine.

## Goal

Verify the engine can run a simple mystery loop without AI:

```text
start scene
  -> inspect object
  -> discover clue
  -> submit accusation
  -> reach ending
```

## Minimal Blueprint

```json
{
  "blueprintVersion": 1,
  "initialState": {
    "sceneId": "study",
    "objective": "Find the culprit",
    "flags": {},
    "discoveredClueIds": [],
    "inventoryItemIds": []
  },
  "suspects": [
    { "id": "butler", "name": "Butler", "role": "House staff" },
    { "id": "doctor", "name": "Doctor", "role": "Guest" }
  ],
  "clues": [
    { "id": "scratch", "name": "Lock scratch", "visibility": "hidden" }
  ],
  "scenes": [
    {
      "id": "study",
      "name": "Study",
      "description": "A locked study.",
      "objectIds": ["door_lock"],
      "actionIds": ["inspect_lock"]
    }
  ],
  "objects": [
    {
      "id": "door_lock",
      "name": "Door lock",
      "sceneId": "study",
      "description": "A brass lock."
    }
  ],
  "actions": [
    {
      "id": "inspect_lock",
      "label": "Inspect the lock",
      "intent": "inspect",
      "targetId": "door_lock",
      "conditions": [],
      "effects": [
        { "type": "clue.discover", "clueId": "scratch" }
      ],
      "successText": "You find a fresh scratch inside the lock."
    }
  ],
  "accusation": {
    "enabledWhen": [{ "type": "hasClue", "clueId": "scratch" }],
    "correctSuspectId": "butler",
    "requiredClueIds": ["scratch"],
    "successEndingId": "solved",
    "failureEndingId": "wrong"
  },
  "endings": [
    { "id": "solved", "name": "Solved" },
    { "id": "wrong", "name": "Wrong accusation" }
  ]
}
```

## Expected Steps

1. `createBlueprintRuntimeState(blueprint)`
   - `sceneId` is `study`
   - `discoveredClueIds` is empty

2. `getAvailableBlueprintActions(blueprint, state)`
   - returns `inspect_lock`

3. `executeBlueprintAction(blueprint, state, "inspect_lock")`
   - `allowed` is `true`
   - `discoveredClueIds` includes `scratch`

4. `resolveBlueprintAccusation(blueprint, state, "butler", ["scratch"])`
   - `allowed` is `true`
   - `correct` is `true`
   - `endingId` is `solved`

5. `resolveBlueprintAccusation(blueprint, state, "doctor", ["scratch"])`
   - `allowed` is `true`
   - `correct` is `false`
   - `endingId` is `wrong`

## Accusation Rules

Accusation is stricter than normal actions:

- If `enabledWhen` is not met, the accusation is blocked and no ending is reached.
- If submitted clues include undiscovered clues, the accusation is blocked and no ending is reached.
- If the suspect is correct but required evidence is missing, the accusation is blocked and no ending is reached.
- If the suspect is wrong and accusation is otherwise allowed, the wrong ending is reached.
- If the suspect is correct and required evidence is present, the solved ending is reached.

## Internal API Smoke Test

The same flow can be tested through `POST /api/play/engine`.

### Initialize

```json
{
  "mode": "init",
  "blueprint": {}
}
```

## Conversation Engine API

Once an agent has `builderConfig.blueprint`, creating a conversation through `POST /api/conversations` initializes:

- `conversation.runtimeState`
- `conversation.currentScene`
- `conversation.currentObjective`

The stored `runtimeState` shape is:

```json
{
  "engine": "blueprint-v1",
  "blueprint": {},
  "state": {},
  "nextActionIds": []
}
```

### Execute Session Action

```http
POST /api/conversations/{conversationId}/engine
```

```json
{
  "mode": "action",
  "actionId": "inspect_lock"
}
```

The API loads the stored engine state, executes the action, updates `runtimeState`, and returns the new result.

The response includes `result.narrative` when AI narration succeeds. This text is generated after the engine result and must not add new facts, clues, items, scene changes, or endings. If narration fails, the API falls back to the engine's deterministic text.

The API also persists two messages:

- a user message with the action label
- an assistant message with the final narrative

### Resolve Session Accusation

```http
POST /api/conversations/{conversationId}/engine
```

```json
{
  "mode": "accuse",
  "suspectId": "butler",
  "clueIds": ["scratch"]
}
```

The API updates the session ending fields when the accusation reaches an ending.

The accusation response also includes `result.narrative` with the same boundary: AI describes the engine-approved ending but does not decide whether the accusation is correct.

The accusation is persisted as a user message, and the resulting ending narration is persisted as an assistant message.

Expected response:

```json
{
  "state": {},
  "nextActionIds": ["inspect_lock"]
}
```

### Execute Action

```json
{
  "mode": "action",
  "blueprint": {},
  "state": {},
  "actionId": "inspect_lock"
}
```

Expected response:

```json
{
  "result": {
    "allowed": true,
    "effects": [{ "type": "clue.discover", "clueId": "scratch" }]
  }
}
```

### Accuse

```json
{
  "mode": "accuse",
  "blueprint": {},
  "state": {},
  "suspectId": "butler",
  "clueIds": ["scratch"]
}
```

Expected response:

```json
{
  "result": {
    "allowed": true,
    "correct": true,
    "endingId": "solved"
  }
}
```
