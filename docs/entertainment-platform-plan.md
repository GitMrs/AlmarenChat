# Entertainment Platform Plan

## 1. Product Direction

The next version will shift from a general AI Agent chat platform to an entertainment-first interactive platform.

Core positioning:

- AI-powered reasoning games
- Role-playing experiences
- Interactive stories
- Social and party-style narrative games

The platform should feel less like "choose an assistant" and more like "enter a playable world".

## 2. Naming Shift

Current language:

- Agent
- Chat
- Prompt
- Conversation

New product language:

- Character
- Story
- World
- Room
- Case
- Scene
- Clue
- Mission
- Relationship
- Ending

The codebase can keep some internal names temporarily, but user-facing UI should gradually move to entertainment language.

## 3. Core User Experience

### Home

Purpose: help users quickly enter an entertaining experience.

Expected sections:

- Continue playing
- Featured worlds
- Mystery cases
- Role-play rooms
- Interactive stories
- Trending characters

The first screen should show playable content, not a generic Agent directory.

### Plaza

Rename conceptually from Agent Plaza to World / Story Plaza.

Categories:

- Mystery
- Romance
- Fantasy
- Urban drama
- Social deduction
- Psychological game
- Comedy
- Horror
- Adventure

Cards should emphasize:

- Story hook
- Play style
- Estimated session length
- Number of roles
- Difficulty
- Tags

### Detail Page

The detail page should introduce a playable experience.

Content:

- World or story title
- Hook
- Opening scene
- Player role
- Rules
- Goals
- Possible endings
- Featured characters

Primary action:

- Start playing

Secondary actions:

- Favorite
- Share
- View characters

### Chat / Play Page

This becomes the core game interface.

Besides messages, it should support:

- Current scene
- Player identity
- Current objective
- Clue board
- Inventory
- Relationship values
- Story progress
- Quick action choices

For the first iteration, keep the current chat layout and add lightweight side/context panels.

### Create Page

Rename conceptually from Create Agent to Create World / Character / Story.

Creation types:

- Character
- Story
- Mystery case
- Role-play room

Fields:

- Title
- Genre
- Hook
- World setting
- Player role
- Character setting
- Opening scene
- Rules
- Win / ending conditions
- Tone
- Safety boundaries

### Profile

Profile should focus on ownership and continuation.

Sections:

- My worlds
- My characters
- My stories
- Drafts
- Published works
- Continue playing
- Favorites

## 4. Data Model Direction

Short-term:

- Reuse current Agent as the underlying playable entity.
- Add entertainment-facing fields gradually.
- Keep conversations as play sessions.

Possible future models:

- World
- Character
- StoryTemplate
- PlaySession
- SceneState
- Clue
- InventoryItem
- RelationshipState

Do not migrate everything at once. Start with UI language and lightweight metadata.

## 5. First Version Scope

Version 2 should focus on product feel, not complex game engine logic.

Recommended first scope:

1. Rework home page into entertainment discovery.
2. Rework plaza categories and cards.
3. Rework detail page into story/world entry.
4. Rework create page labels and fields.
5. Add play-context panel to chat page.
6. Update profile language.

Avoid in first pass:

- Multiplayer realtime rooms
- Complex game state engine
- Payment system
- Full achievement system
- Heavy database migration

## 6. Migration Strategy

Use the current project as the base.

Reasons:

- Auth already exists.
- Conversations already exist.
- Favorites already exist.
- Custom creation already exists.
- Admin and quota controls already exist.
- Upload support already exists.
- Deployment flow already exists.

Branch:

- `codex/entertainment-platform`

Suggested implementation order:

1. Update planning and terminology map.
2. Rework home page.
3. Rework plaza.
4. Rework detail page.
5. Rework create page.
6. Rework chat play experience.
7. Rework profile.
8. Review admin implications.

## 7. Design Principles

- Playable first screen.
- Strong story hooks.
- Less generic productivity language.
- Cards should sell experiences, not tools.
- Chat should feel like a game interface, not only a message thread.
- Keep controls practical and lightweight.
- Do not overbuild the game engine before the entertainment shell works.

## 8. Open Questions

- Should the main unit be called World, Story, Room, or Character?
- Should mystery cases and role-play rooms share the same creation flow?
- Should sessions have visible progress and endings in v2?
- Should users publish characters, stories, or complete worlds?
- How much game state should be persisted in the first version?
