# Claude Code Instructions

## Commands to Run

### Lint (always run after making changes)
```bash
deno lint src/
```

### Format
```bash
deno fmt src/ deno.json index.html vite.config.ts
```

### Build
```bash
deno task build
```

### Dev server
```bash
deno task dev
```

---

## Backwards Compatibility

**Do not worry about backwards compatibility.** When refactoring or writing code, feel free to rename functions, change signatures, remove unused code, and restructure APIs as needed. This is a personal project without external consumers—prioritize clean design over preserving old interfaces.

---

## Software Design Philosophy (Ousterhout)

Core principle: **complexity is the root cause of most software problems**. Every design decision should minimize complexity.

### 1. Deep Modules

Modules should have simple interfaces that hide significant implementation complexity. The best modules provide powerful functionality through minimal API surface.

```typescript
// SHALLOW (bad): interface complexity ≈ implementation complexity
class ShallowFileReader {
  openFile(path: string): FileHandle { }
  readBytes(handle: FileHandle, offset: number, length: number): Buffer { }
  closeFile(handle: FileHandle): void { }
}

// DEEP (good): simple interface hides complexity
class DeepFileReader {
  readFile(path: string): string { }  // handles open, read, close, encoding, errors
}
```

### 2. Information Hiding

Hide implementation details. Expose only what callers need. When implementation changes, callers shouldn't need to change.

```typescript
// BAD: leaks implementation details
class UserCache {
  public cache: Map<string, User> = new Map();
  public ttlMs: number = 60000;
  public lastCleanup: number = Date.now();
}

// GOOD: hides implementation
class UserCache {
  private cache = new Map<string, { user: User; expires: number }>();

  get(id: string): User | undefined { }
  set(id: string, user: User): void { }
}
```

### 3. Different Layer, Different Abstraction

Each layer in a system should provide a distinct abstraction. Pass-through methods that add no value indicate poor layer design.

```typescript
// BAD: layers mirror each other
class UserRepository {
  getUser(id: string): User { }
}
class UserService {
  getUser(id: string): User { return this.repo.getUser(id); }  // pointless pass-through
}

// GOOD: each layer adds value
class UserRepository {
  findById(id: string): UserRecord | null { }  // raw data access
}
class UserService {
  getActiveUser(id: string): User {  // business logic: validates, transforms, checks status
    const record = this.repo.findById(id);
    if (!record || record.deletedAt) return null;
    return this.toUser(record);
  }
}
```

### 4. Pull Complexity Downward

When complexity is unavoidable, push it into implementation rather than exposing it in interfaces. Make life easier for callers.

```typescript
// BAD: caller handles complexity
function sendEmail(to: string, subject: string, body: string,
  retries: number, backoffMs: number, timeout: number): Promise<void>

// GOOD: implementation handles complexity
function sendEmail(to: string, subject: string, body: string): Promise<void>
// internally handles retries, backoff, timeouts with sensible defaults
```

### 5. Define Errors Out of Existence

Design APIs so errors cannot occur, rather than handling them after the fact.

```typescript
// BAD: caller must handle errors
function getElement<T>(arr: T[], index: number): T {
  if (index < 0 || index >= arr.length) throw new Error("out of bounds");
  return arr[index];
}

// GOOD: error cannot occur
function getElement<T>(arr: T[], index: number, defaultValue: T): T {
  return arr[index] ?? defaultValue;
}

// GOOD: use types to prevent errors
type NonEmptyArray<T> = [T, ...T[]];
function first<T>(arr: NonEmptyArray<T>): T {
  return arr[0];  // always safe
}
```

### 6. Strategic vs Tactical Programming

Tactical = "just make it work". Strategic = invest time in good design. Tactical creates technical debt; strategic pays off long-term.

```typescript
// TACTICAL (bad): quick fix, creates debt
function processOrder(order: Order) {
  // TODO: fix this later
  if (order.type === "subscription") {
    // copy-pasted code with slight modifications
  }
}

// STRATEGIC (good): invest in clean abstraction
interface OrderProcessor {
  process(order: Order): Result;
}
class SubscriptionProcessor implements OrderProcessor { }
class OneTimeProcessor implements OrderProcessor { }
```

### 7. Comments: Describe What's Not Obvious

Comments should explain WHY and provide information that cannot be inferred from the code. Don't repeat what code already says.

```typescript
// BAD: repeats the code
// increment i by 1
i++;

// BAD: says what, not why
// check if user is admin
if (user.role === "admin") { }

// GOOD: explains why
// Admin users bypass rate limiting because they need unrestricted
// access for debugging production issues
if (user.role === "admin") { }

// GOOD: documents non-obvious behavior
// Returns cached value if available and less than 5 minutes old.
// Cache is invalidated when any user in the same org updates their profile.
function getUser(id: string): User { }
```

### 8. General-Purpose Over Special-Purpose

Somewhat general-purpose code is often simpler than special-purpose code. Avoid encoding specific use cases into core abstractions.

```typescript
// BAD: special-purpose, hard to reuse
function formatUserNameForHeader(user: User): string { }
function formatUserNameForEmail(user: User): string { }

// GOOD: general-purpose, flexible
function formatName(first: string, last: string, style: "full" | "abbreviated"): string { }
```

### Summary Checklist

- Is this module deep? (simple interface, complex implementation)
- Does this layer add a new abstraction?
- Am I hiding implementation details?
- Can I define this error out of existence?
- Am I pushing complexity down into implementation?
- Will this comment help future readers understand WHY?
- Is this general enough to reuse, but not over-engineered?
