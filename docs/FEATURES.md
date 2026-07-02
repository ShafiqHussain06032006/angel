# Angel VSCode Extension - Enhanced Features Documentation

## Overview

Angel is an advanced VSCode extension that provides multi-agent AI-powered software development capabilities with integrated planning, progress tracking, task management, and feedback collection.

## New Features

### 1. **Multi-Agent Orchestration System**

#### Planning Agent
- Dedicated agent for structured project planning
- Generates comprehensive plans with 6 sections:
  - Project Overview
  - Requirements Analysis
  - Architecture Decisions
  - Implementation Milestones
  - Dependencies and Risks
  - Development Workflow
- Supports conversation-based iterative planning
- Saves plans to `.angel/PROJECT_PLAN.md`

#### Enhanced Orchestrator
- Automatic TODO generation based on project analysis
- Smart detection of new vs existing projects
- Context-aware task assignment to agents
- Dependency chain management

### 2. **Task Management (TODO System)**

#### Features
- Automatic TODO list generation
- Task status tracking (pending, in-progress, completed, blocked)
- Priority levels (low, medium, high)
- Dependency management
- Agent-specific task assignment

#### Usage
```typescript
import { TodoService } from './services/todo';

const todoService = new TodoService(workspaceRoot);

// Orchestrator automatically generates TODOs
// Or create manually:
todoService.createTodoList('DeveloperAgent', [
  {
    title: 'Implement feature X',
    description: 'Build the core functionality',
    assignedAgent: 'DeveloperAgent',
    status: 'pending',
    dependencies: [],
    priority: 'high'
  }
]);
```

### 3. **Agent Feedback System**

#### Features
- Tracks completed tasks per agent
- Records issues encountered with severity levels (critical, high, medium, low)
- Collects suggestions for improvements
- Documents next steps
- Aggregates feedback across all agents

#### Usage
```typescript
import { FeedbackService } from './services/feedback';

const feedbackService = new FeedbackService(workspaceRoot);

feedbackService.createFeedback(
  'DeveloperAgent',
  ['Generated code files', 'Ran tests'],
  ['Fix compilation errors'],
  [{ severity: 'high', description: 'TypeScript errors', context: 'src/main.ts' }],
  ['Add type annotations'],
  ['Fix errors before deployment']
);
```

### 4. **Real-Time Progress Tracking**

#### Features
- Pipeline execution monitoring
- Stage-by-stage progress tracking
- Percentage completion calculation
- Estimated time remaining
- Visual indicators in VSCode status bar

#### Status Bar Display
- **Idle**: `$(pulse) Angel Ready`
- **Running**: `$(sync~spin) DeveloperAgent: 45% (~30s remaining)`
- **Completed**: `$(check) Angel Complete`
- **Error**: `$(error) Angel Error`

### 5. **Enhanced Developer Agent  with Quality Checks**

The DeveloperAgent now includes automatic quality validation:

#### Post-Generation Checks
1. **Dependency Installation**: Automatically runs `npm install`
2. **TypeScript Compilation**: Validates code compiles without errors
3. **Test Execution**: Runs test suite automatically
4. **Linting**: Checks code quality with linter

#### Feedback Generation
- Reports all completed tasks
- Documents issues encountered during checks
- Provides actionable suggestions
- Suggests next steps based on results

### 6. **Conversation Management**

#### Features
- Persistent conversation storage in `.angel/conversations/`
- Multiple conversation modes (planning, development, chat)
- Export/import conversations
- Message history with timestamps
- Agent identification in messages

#### Usage
```typescript
import { ConversationService } from './services/conversation';

const convService = new ConversationService(workspaceRoot);

// Create conversation
const convId = convService.createConversation('Project Planning', 'planning');

// Add messages
convService.addMessage(convId, 'user', 'What architecture should we use?');
convService.addMessage(convId, 'assistant', 'I recommend...', 'PlanningAgent');
```

### 7. **Project Analysis**

#### Features
-Automatic project structure analysis
- Main language detection
- Framework detection (React, Vue, Next.js, Express, etc.)
- Dependency analysis
- New vs existing project identification

#### Context Generation
Provides rich project context to agents for better decision-making

## UI Components

### Enhanced Sidebar
- **TODOs Panel**: View all agent tasks with status and priorities
- **Feedback Panel**: See aggregated feedback from all agents
- **Conversations Panel**: Browse planning and development conversations
- **Tab Navigation**: Easy switching between panels

### Activity Bar Progress
- Real-time agent execution status
- Progress percentage display
- Time estimates
- Visual status indicators

## File Structure

```
workspace/
└── .angel/
    ├── conversations/          # Conversation history
    ├── todos/                  # TODO lists by agent
    ├── feedback/               # Agent feedback
    └── PROJECT_PLAN.md        # Planning output
```

## Configuration

No additional configuration required. All services initialize automatically based on workspace root.

## Best Practices

### For Planning
1. Start with high-level requirements
2. Iterate with the Planning Agent for detailed planning
3. Review generated plan before proceeding to implementation

### For Development
1. Let OrchestratorAgent analyze project and generate TODOs
2. Review TODO list for accuracy
3. Execute agents in sequence
4. Monitor progress in activity bar
5. Review feedback after each stage
6. Address critical issues before proceeding

### For Quality
1. Always let DeveloperAgent run quality checks
2. Fix critical/high severity issues immediately
3. Review feedback for code improvement suggestions
4. Run tests before deployment

## API Reference

### TodoService
- `createTodoList(agentName, tasks)`: Create TODO list
- `updateTaskStatus(agentName, taskId, status)`: Update task status
- `getTodoList(agentName)`: Get agent's TODO list
- `getTodoSummary()`: Get summary of all TODOs

### FeedbackService
- `createFeedback(...)`: Create agent feedback
- `getAgentFeedback(agentName)`: Get agent's feedback history
- `getCriticalIssues()`: Get all critical/high severity issues
- `getFeedbackSummary()`: Get summary of all feedback

### ProgressIndicator
- `initialize(stages)`: Initialize with stage names
- `startStage(stageName, agentName)`: Start a stage
- `completeStage()`: Complete current stage
- `getState()`: Get current progress state
- `addListener(callback)`: Listen to progress updates

### ConversationService
- `createConversation(title, mode)`: Create new conversation
- `addMessage(conversationId, role, content, agentId)`: Add message
- `getConversation(conversationId)`: Get conversation
- `getAllConversations()`: List all conversations

## Troubleshooting

### TODOs Not Generated
- Ensure workspace root is set correctly
- Check if OrchestratorAgent has necessary permissions
- Review logs for errors

### Tests Failing
- Check that `test` script exists in package.json
- Verify dependencies are installed
- Review test output in feedback

### Feedback Not Showing
- Ensure FeedbackService is initialized with correct workspace root
- Check `.angel/feedback/` directory permissions
- Verify agents are calling feedback generation

## Future Enhancements

- Integration with external issue trackers
- Advanced analytics dashboard
- Custom agent workflows
- Team collaboration features
- Cloud synchronization for conversations and TODOs

## Support

For issues and feature requests, please file an issue in the project repository.
