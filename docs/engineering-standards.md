# Engineering Standards & Prompts

## Core Principles

### Philosophy

- **Let it crash**: Fail fast on invalid inputs. No defensive fallbacks or "just in case" logic unless explicitly required.
- **Explicit failure**: Prefer raising errors over silent failures, default values, or swallowing exceptions.
- **Trust contracts**: Use type systems and assertions to enforce contracts. If data is wrong, that's a bug—let it surface.
- **Simple > Clever**: Boring, maintainable code beats clever optimizations.
- **Build for today**: Design for current requirements, not imagined future ones.

### Quality Bar

- Maintainable by someone else in 6 months
- Obvious what it does
- Obvious when it breaks
- Simple enough to reason about completely

---

## Architecture & Design

When designing architecture or system components:

### Design Principles

- **Start simple**: Design for current requirements, not imagined future ones
- **Boring technology**: Prefer well-understood, proven solutions over novel approaches
- **Explicit boundaries**: Clear interfaces and contracts between components
- **Failure domains**: Identify what can fail independently and what needs tight coupling
- **Data flow first**: Understand how data moves before deciding on components

### What to Focus On

- Component boundaries and responsibilities
- Data ownership and flow
- Failure modes and error propagation
- Dependencies and coupling points
- State management strategy
- Testing strategy at architectural level

### What to Avoid

- ❌ Microservices for the sake of microservices
- ❌ Abstract layers "for future flexibility"
- ❌ Enterprise patterns without enterprise problems
- ❌ Distributed systems when a monolith would work
- ❌ Complex message buses when direct calls suffice
- ❌ Generic "frameworks" or "engines" for specific problems

### Key Questions to Answer

- What are the core entities and their relationships?
- Where does state live and who owns it?
- What are the critical paths and hot paths?
- What happens when each component fails?
- What are the hard boundaries vs. soft boundaries?
- What's the simplest thing that could work?

### Trade-off Analysis

For each significant decision, explicitly state:

- **Why this approach**: What problem does it solve?
- **What we're giving up**: Complexity, performance, flexibility?
- **What we're gaining**: Simplicity, clarity, maintainability?
- **Alternatives considered**: What else could work and why not?

### Red Flags to Call Out

- "We might need to scale to..."
- "What if in the future we want to..."
- "This gives us flexibility to..."
- "Industry best practice is..."
- Any decision that adds complexity for hypothetical future needs

### Architecture Output Format

- **Context**: Problem being solved, constraints
- **Core components**: What they do, what they own
- **Boundaries**: Interfaces, contracts, failure domains
- **Data flow**: How information moves through the system
- **Trade-offs**: Key decisions and their rationale
- **Risks**: What could go wrong, what we're uncertain about
- **Open questions**: What needs clarification or experimentation

### Architecture Review Checklist

Red flags in proposed architectures:

- □ More than 3 new components for a feature addition
- □ "Event-driven" without clear justification
- □ Message queues when direct calls would work
- □ Abstractions used only once
- □ "Service" for every domain concept
- □ Caching without measured need
- □ "For scalability" without load numbers
- □ Distributed transactions
- □ Custom protocols instead of HTTP/gRPC
- □ "Eventually consistent" when strongly consistent would work

Green flags:

- □ Could draw the data flow in under 5 minutes
- □ Each component has a clear, single responsibility
- □ Failure modes are explicit
- □ Can explain why simpler approaches won't work
- □ Trade-offs are stated with numbers/constraints

**Design for the system we're building today, not the system we imagine in 3 years.**

---

## Analysis & Planning

When analyzing requirements or designing solutions:

### Analysis Principles

- Break problems into smallest meaningful pieces
- Identify edge cases and failure modes explicitly
- Consider trade-offs (performance, complexity, maintainability)
- Question assumptions—list what we're assuming vs. what we know
- Think about what data structures and boundaries make sense
- Don't jump to implementation details
- Flag ambiguities and risks

### Analysis Output Format

- Clear problem decomposition
- Design decisions with rationale
- Edge cases and failure scenarios
- Open questions that need answering
- Assumptions being made

---

## Code Implementation

Write production-quality code following these principles:

### Code Style

- **Concise and idiomatic**: Write code like a senior engineer, not a tutorial. Favor terseness over explicitness.
- **Small functions**: Keep functions under 10-15 lines. Extract helpers liberally.
- **Single Responsibility**: Each function does one thing well. No god functions.

### Naming

- **Clear but concise**: `getUser` not `getUserDataFromDatabaseById`
- **No cruft**: Avoid prefixes like `str`, `obj`, `user_object`, or suffixes like `Manager`, `Helper`, `Handler` unless truly needed
- **Domain language**: Use the language of the problem domain

### Abstraction

- **Rule of Three**: Don't abstract until you have 3 uses
- **No premature generalization**: Build for current requirements, not hypothetical futures
- **No cargo cult patterns**: Don't add factories, interfaces, or patterns "because best practice"

### Error Handling

- **Contextual messages**: Include what failed, what was expected, and how to fix it
- **No generic errors**: Never "An error occurred" or "Invalid input"
- **Propagate, don't suppress**: Let errors bubble up unless you can meaningfully handle them

### What NOT to Do

- ❌ Don't add try/catch or error suppression unless explicitly needed
- ❌ Don't add null/undefined checks everywhere
- ❌ Don't create interfaces/protocols with only one implementation
- ❌ Don't add comments explaining what code obviously does
- ❌ Don't write defensive "safety" logic for scenarios that indicate bugs
- ❌ Don't optimize prematurely or micro-optimize non-critical paths

### Testing

- Test behavior, not implementation
- Focus on edge cases and failure modes
- Keep tests simple and readable

**When in doubt: simple, explicit, and let it fail.**

---

## Usage Guidelines

### For Architecture Work

Apply the **Core Principles** + **Architecture & Design** sections.

Example prompt:

```
[Paste Core Principles + Architecture sections]

Context: [Your system context]
Design an approach for: [Your architectural challenge]
```

### For Analysis Work

Apply the **Core Principles** + **Analysis & Planning** sections.

Example prompt:

```
[Paste Core Principles + Analysis sections]

Analyze this requirement: [Your requirement]
```

### For Implementation Work

Apply the **Core Principles** + **Code Implementation** sections.

Example prompt:

```
[Paste Core Principles + Code Implementation sections]

Implement: [Your feature/function]
Given: [Relevant context, specs, or architectural decisions]
```

### Iterative Refinement

1. Get initial output
2. "Simplify this—you're over-engineering"
3. "What's the simplest version that could work?"
4. "Remove unnecessary abstractions"
5. "Make this more concise/idiomatic"
