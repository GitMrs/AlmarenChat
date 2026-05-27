# AlmarenChat Agent Platform Plan

## 1. Positioning

AlmarenChat will be rebuilt as a consumer-facing AI Agent chat platform.

The core user journey is:

1. Discover an Agent.
2. Read what the Agent can do.
3. Start a conversation.
4. Save and continue conversation history.
5. Create and customize personal Agents.

This product is not positioned as a social IM app.

## 2. Assumptions

- The primary audience is individual users.
- AI Agent chat is the main feature.
- Human-to-human chat is out of scope for the MVP.
- Friends, groups, online status, read receipts, and typing indicators are not MVP features.
- The existing IM prototype is preserved in Git history and can be used as reference only.
- The new implementation should prefer a simpler Agent-first architecture over adapting the old IM structure.

## 3. MVP Scope

### In Scope

- User registration and login.
- Agent discovery homepage.
- Agent list with categories and search.
- Agent detail page.
- AI chat with selected Agent.
- Streaming AI response.
- Conversation persistence.
- Custom Agent creation.
- Custom Agent editing and deletion.
- My Agents page.
- Conversation history page.
- Basic account settings.

### Out of Scope

- Friend system.
- Group chat.
- Human-to-human chat.
- Online status.
- Message delivered/read states.
- Social feed.
- Payments.
- Public reviews.
- Knowledge base.
- Tool calling.
- Complex admin console.

## 4. Product Structure

### Primary Pages

```text
/
  Agent discovery homepage

/agents
  Agent list, categories, search

/agents/[agentId]
  Agent detail page

/chat/[agentId]
  Chat with selected Agent

/conversations
  User conversation history

/create-agent
  Create custom Agent

/my-agents
  Manage user-created Agents

/settings
  Account and model settings
```

### Navigation Priority

The first screen should prioritize Agent discovery, not chat history.

Recommended top-level navigation:

- Discover
- Agents
- Create
- Conversations
- My Space

## 5. Visual Direction

The UI should feel consumer-facing, expressive, and Agent-first.

Design principles:

- Bright, polished, and approachable.
- Agent cards should feel like identity cards, not database rows.
- Each Agent should have a recognizable personality.
- Chat pages should feel like entering an Agent-specific room.
- Creation flow should feel like shaping a character, not filling an admin form.

Avoid:

- Enterprise dashboard style.
- Social IM visual patterns as the main structure.
- Overly dark sci-fi styling.
- Generic SaaS landing-page composition.

## 6. Core Concepts

### Agent Identity Card

Each Agent should expose:

- Avatar.
- Name.
- Short description.
- Category.
- Tone.
- Capabilities.
- Greeting.
- Suggested prompts.
- Start chat action.
- Favorite action.

### Chat Experience

The chat page should include:

- Agent header.
- Greeting message.
- Suggested prompt chips.
- Message list.
- Streaming assistant response.
- Stop generation.
- Regenerate response.
- Copy message.
- Conversation title.

### Create Agent Flow

MVP fields:

- Name.
- Avatar.
- Description.
- Category.
- Tone.
- Greeting.
- System prompt.
- Model.
- Public/private visibility.

The creation page should show a live preview when feasible.

## 7. Technical Direction

Recommended stack:

```text
Next.js
TypeScript
Tailwind CSS
Prisma
SQLite for MVP
PostgreSQL later if needed
OpenAI-compatible AI provider layer
```

Keep MVP simple:

- No Redux/Zustand unless local state becomes painful.
- No queue system.
- No microservices.
- No complex permission system.
- No payment integration in MVP.

## 8. Initial Data Model

```text
User
- id
- email
- passwordHash
- name
- avatar
- createdAt
- updatedAt

Agent
- id
- creatorId
- name
- avatar
- description
- category
- tone
- greeting
- systemPrompt
- model
- isPublic
- createdAt
- updatedAt

Conversation
- id
- userId
- agentId
- title
- createdAt
- updatedAt

Message
- id
- conversationId
- role
- content
- createdAt

FavoriteAgent
- id
- userId
- agentId
- createdAt
```

Later models:

```text
KnowledgeBase
KnowledgeDocument
AgentTool
AgentReview
AgentUsage
Subscription
Payment
```

## 9. Development Phases

### Phase 1: Project Foundation

Goal: Establish the new Agent-first application foundation.

Step -> Verify:

1. Create or reset the app structure for Next.js.
   Verify: development server starts successfully.
2. Configure TypeScript and Tailwind.
   Verify: build and type check pass.
3. Create primary routes.
   Verify: all planned MVP pages are reachable.
4. Add base layout and navigation.
   Verify: product clearly feels Agent-first.

### Phase 2: Static Product Prototype

Goal: Validate the consumer-facing UI before wiring backend logic.

Step -> Verify:

1. Build Agent discovery homepage.
   Verify: users can understand what the platform does from the first screen.
2. Build Agent card component.
   Verify: multiple Agents feel visually distinct.
3. Build Agent detail page.
   Verify: users can decide whether to chat with the Agent.
4. Build static chat page.
   Verify: chat UX feels polished and not like a generic IM clone.
5. Build create Agent page.
   Verify: the flow feels like creating an Agent identity.

### Phase 3: Data and Auth

Goal: Persist users, Agents, conversations, and messages.

Step -> Verify:

1. Define Prisma schema.
   Verify: migration succeeds.
2. Implement registration and login.
   Verify: users can log in and return after refresh.
3. Implement Agent CRUD.
   Verify: users can create, edit, and delete their own Agents.
4. Implement conversation and message persistence.
   Verify: chat history remains after refresh.

### Phase 4: AI Chat

Goal: Make Agent conversations real.

Step -> Verify:

1. Implement AI provider abstraction.
   Verify: default provider can generate text.
2. Add streaming response.
   Verify: assistant response streams into the chat UI.
3. Apply Agent system prompt and greeting.
   Verify: different Agents respond with distinct behavior.
4. Save assistant responses.
   Verify: full conversation can be resumed later.

### Phase 5: Consumer Experience Polish

Goal: Improve retention and daily use.

Step -> Verify:

1. Add favorites.
   Verify: users can save Agents and find them later.
2. Add recent conversations.
   Verify: users can continue previous chats quickly.
3. Add search and categories.
   Verify: users can find Agents by intent.
4. Add loading, empty, and error states.
   Verify: common failure paths remain understandable.

## 10. Success Criteria

MVP is successful when:

- A new user can register and log in.
- The homepage presents Agents as the primary product object.
- The user can choose an Agent and start chatting.
- AI responses stream successfully.
- Chat history is saved and can be resumed.
- The user can create a custom Agent.
- The custom Agent can be used immediately in chat.
- The product does not depend on social IM features.

## 11. Immediate Next Step

Start with Phase 1 and Phase 2.

Before connecting backend logic, create a polished static version of:

1. Agent discovery homepage.
2. Agent card.
3. Agent detail page.
4. Agent chat page.
5. Create Agent page.

This keeps the product direction visible before backend work begins.
