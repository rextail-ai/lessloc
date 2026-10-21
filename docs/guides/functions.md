---
title: "Writing good functions with AI coding agents"
description: "Shapes to avoid and shapes to prefer when AI coding agents write functions, each with a short Python example, and what lessloc does about it."
---

# Writing good functions with AI agents

An AI coding agent can make a task pass and still leave the code harder to change. What matters for the next task is the shape the code is left in: how it is split into functions, how deep it nests, how many special cases pile up in one place. The next person, or the next agent session, pays for that shape.

This page lists shapes to avoid and shapes to prefer, each with a short Python example. Then it shows what lessloc does about it. The ideas hold in any language.

## Shapes to avoid

### Brute force and copy-paste

Brute force is writing by hand what the language already has:

```python
late = False
for order in orders:
    if order.status == "late":
        late = True
```

`late = any(order.status == "late" for order in orders)` says the same in one line.

Copy-paste is the same rule written again under new names. Here, in `shop/billing.py`:

```python
def invoice_total(items):
    subtotal = sum(item.price * item.qty for item in items)
    fee = max(0.30, subtotal * 0.029)
    return round(subtotal + fee, 2)


def quote_total(lines):
    amount = sum(line.price * line.qty for line in lines)
    fee = max(0.30, amount * 0.029)
    return round(amount + fee, 2)
```

When the fee changes, someone updates one of them, and quotes stop matching invoices. Agents rarely reuse: a new session does not know what earlier sessions wrote, and writing a function is one step while finding the old one takes a search. The fix is to call the function that exists, or to give the rule one home that both call.

### Accretion of special-case branches

Each task adds one more branch. No single change looks wrong, and a year later the function is a list of exceptions.

```python
def shipping_cost(order):
    if order.country == "US":
        return 5
    elif order.country == "CA":
        return 8
    elif order.country == "MX":
        return 9
    elif order.country == "DE" and order.total > 100:
        return 0
    elif order.country == "DE":
        return 12
    return 15
```

For one task, the smallest change that passes is often one more `elif`. See [data instead of growing branches](#data-instead-of-growing-branches).

### Arrow code

Nested conditions push the real work to the right edge, in the shape of an arrowhead. To know when a line runs, a reader must keep every condition above it in mind.

```python
def apply_coupon(order, code):
    if order is not None:
        if code:
            coupon = COUPONS.get(code)
            if coupon:
                if not coupon.expired:
                    if order.total >= coupon.minimum:
                        order.total -= coupon.amount
                        return True
    return False
```

See [guard clauses](#guard-clauses).

### God functions

One function parses the input, applies the business rules, writes to the database and sends the email. Any change to any of these touches it, and testing one rule means setting up all of it.

```python
def checkout(request):
    data = json.loads(request.body)
    if "items" not in data:
        return {"error": "no items"}, 400
    total = 0
    for item in data["items"]:
        product = db.get_product(item["id"])
        total += product.price * item["qty"]
    if data.get("coupon") == "SPRING":
        total *= 0.9
    order_id = db.insert_order(data["user"], total)
    send_email(data["user"], f"Order {order_id}: {total:.2f}")
    return {"id": order_id, "total": total}, 200
```

Real ones run to hundreds of lines. They grow because each task adds its piece where the data already is.

### Hidden coupling

Two pieces of code depend on each other through something neither signature shows: a module variable, the order of calls, or an argument changed in place.

```python
_currency = "USD"


def set_currency(code):
    global _currency
    _currency = code


def format_price(amount):
    return f"{amount:.2f} {_currency}"  # depends on who called set_currency last


def add_tax(order):
    order.total *= 1.2  # the caller's order changes too
    return order.total
```

Whoever reads `format_price` alone, person or agent, cannot see the link, and a change somewhere else can break it.

### Premature generality

Options, flags, base classes and settings for cases nobody asked for. Each one is code to read, test and keep working. Anthropic's prompting guide says recent Claude models "have a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested."

```python
from abc import ABC, abstractmethod


class Exporter(ABC):
    @abstractmethod
    def export(self, rows, delimiter=",", quote_all=False): ...


class CsvExporter(Exporter):  # the only exporter there is
    def export(self, rows, delimiter=",", quote_all=False):
        ...
```

A boolean parameter that switches behavior is the small form of the same thing. It is two functions in one, and every caller must know which mode it wants:

```python
def total(items, include_tax=False):
    subtotal = sum(i.price for i in items)
    return subtotal * 1.2 if include_tax else subtotal
```

### Clever density

Code golfed into one line is shorter, but slower to read and easier to get wrong.

```python
label = "high" if score > 80 else "mid" if score > 50 else "low"
cells = [cell for row in grid for cell in row if cell]
```

The Google Python Style Guide puts it plainly: "Optimize for readability, not conciseness." An `if` statement or a plain loop is easier to read and to change.

## Shapes to prefer

### One job per function, at one level of detail

```python
def checkout(request):
    order = parse_order(request.body)
    total = price(order.items, order.coupon)
    order_id = save_order(order, total)
    send_receipt(order.user, order_id, total)
    return {"id": order_id, "total": total}, 200
```

Each line is one step, and all steps sit at the same level. How each step works lives one level down, where a change to pricing does not touch the email. Split by job, not by line count: a one-line helper used once only moves the line somewhere else.

### A pure core with I/O at the edges

```python
def late_fee(amount, days_late):
    if days_late <= 0:
        return 0
    return min(amount * 0.01 * days_late, amount * 0.2)


def charge_late_fees(db, today):
    for invoice in db.unpaid_invoices():
        fee = late_fee(invoice.amount, (today - invoice.due).days)
        db.add_fee(invoice.id, fee)
```

`late_fee` needs no database, clock or network, so its test is one line: `assert late_fee(100, 30) == 20`. `charge_late_fees` only reads, calls and writes. When the fee rule changes, one small function changes, and its tests stay fast. This shape is sometimes called "functional core, imperative shell".

### Data instead of growing branches

```python
SHIPPING = {"US": 5, "CA": 8, "MX": 9, "DE": 12}
FREE_OVER = {"DE": 100}


def shipping_cost(order):
    if order.total > FREE_OVER.get(order.country, float("inf")):
        return 0
    return SHIPPING.get(order.country, 15)
```

This does what the chain above does. A new country is one entry instead of one more branch, and the free-shipping rule is written once.

### Guard clauses

```python
def apply_coupon(order, code):
    coupon = COUPONS.get(code)
    if order is None or coupon is None or coupon.expired:
        return False
    if order.total < coupon.minimum:
        return False
    order.total -= coupon.amount
    return True
```

The same checks as the arrow above, flat. Each guard handles one way out and returns early, and the main path reads straight down. Fowler's *Refactoring* calls this Replace Nested Conditional with Guard Clauses.

### Generalize at the third case

```python
# The first two cases, written out. Two cases do not yet show what will vary.
def vip_price(total):
    return total * 0.8


def staff_price(total):
    return total * 0.7


# The third case shows the pattern: one rule, and a table of rates.
RATES = {"vip": 0.8, "staff": 0.7, "student": 0.9}


def group_price(total, group):
    return total * RATES[group]
```

Fowler's *Refactoring* calls this the rule of three. An abstraction built at the first or second case is a guess about what will vary, and a wrong guess is expensive. As Sandi Metz put it, "duplication is far cheaper than the wrong abstraction". Once the shared version exists, delete the functions it replaces.

### Deep modules

In *A Philosophy of Software Design*, John Ousterhout calls a module deep when a small interface hides a lot of work, and shallow when it hides little and makes every caller know the steps.

```python
from decimal import ROUND_HALF_UP, Decimal


# Shallow: every caller must chain the steps, in the right order.
def to_decimal(value):
    return Decimal(str(value))


def round_cents(amount):
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


text = f"{round_cents(to_decimal(total)):,}"
```

```python
# Deep: one call, and the rounding rule lives in one place.
def money(value):
    """An amount as invoices show it, rounded half up: 1234.505 becomes 1,234.51."""
    cents = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{cents:,}"


money(2.675)     # '2.68'
round(2.675, 2)  # 2.67: the float 2.675 is stored just below 2.675
```

Callers of `money` never need to know why plain `round` gets that case wrong.

### Names for concepts

```python
# The reader decodes the rule at every place it appears:
if order.country in ("DE", "FR", "NL") and order.total > 100 and not order.gift_card:
    ...


# The rule has a name and one home:
def ships_free(order):
    if order.gift_card:
        return False
    return order.country in FREE_COUNTRIES and order.total > FREE_SHIPPING_MINIMUM
```

A name earns a function when it says something the code cannot say by itself: `ships_free` names a business rule. A function that only repeats its one line, such as `def get_total(order): return order.total`, adds a jump and nothing else. Vague names such as `process_data`, `handle` or a `utils` module name nothing at all.

### Reshape first, then change

Kent Beck's advice: "for each desired change, make the change easy (warning: this may be hard), then make the easy change."

```python
# Before: the tax rate is written in two places.
def invoice_total(items):
    return sum(i.price * 1.20 for i in items)


def receipt_lines(items):
    return [f"{i.name}: {i.price * 1.20:.2f}" for i in items]
```

The task: books are taxed at 5%. The quick fix adds a book check in both places. Instead, reshape first, with no change in behavior, so the existing tests pass unchanged:

```python
def gross(item):
    return item.price * 1.20


def invoice_total(items):
    return sum(gross(i) for i in items)


def receipt_lines(items):
    return [f"{i.name}: {gross(i):.2f}" for i in items]
```

Then the change touches one function:

```python
TAX_FACTOR = {"book": 1.05}


def gross(item):
    return item.price * TAX_FACTOR.get(item.kind, 1.20)
```

Two small steps are easier to review than one tangled one. You can ask an agent for exactly this: "First move the tax rule into one function, with no behavior change, and run the tests. Then add the book rate, with a test."

## What lessloc does about it

The working standard every session starts with ([the whole text](/guide/how-it-works#session-start)) covers some of these shapes: take what the codebase, the standard library or an installed dependency already has before writing new code; one implementation per rule; no wrapper, option, flag, config, interface or file nobody asked for; delete what the change makes dead.

When the agent says it is done, lessloc reviews what it wrote. These are the findings about function shape:

| Kind | What it finds | During the session |
|---|---|---|
| [`copy`](/patterns/reuse-helper) | A new function whose body matches an existing one except for local names, or a block of 6 or more lines (`dupLines`) that the change mostly wrote and that also exists elsewhere | Holds the turn, once |
| [`if-chain`](/patterns/if-chain) | 3 or more `if`/`elif` branches comparing one variable with a literal value, at least one of them new | Note |
| [`deep-nesting`](/patterns/deep-nesting) | A new control statement inside 3 or more other control blocks | Note |
| [`long-function`](/patterns/long-function) | A function over 100 code lines, at least 20 of them written by the change | Note |
| [`clever`](/patterns/golfed-code) | In Python, a nested conditional expression or a comprehension with several `for` clauses; in JavaScript, TypeScript, Java, C#, C and C++ and others, a nested ternary | Note |
| [`mode-flag`](/patterns/speculative-options) | An existing function that gains a boolean parameter | Note |
| [`single-use`](/patterns/single-use) | A new one-line helper used once | Note |

On this page's examples, the copy-paste pair is a `copy`, the shipping chain an `if-chain`, the coupon arrow `deep-nesting`, both golfed lines `clever`, and `total` gaining `include_tax` a `mode-flag`. The base class with its single subclass is a `single-impl` note.

For the copy, the agent reads one line like this in the turn's hold, before it may finish:

```text
- shop/billing.py:7: `quote_total` has the same body as `invoice_total` (shop/billing.py:1, used in 2 file(s)) with names changed: call or merge into one
```

These notes never reach the agent during the turn. They go into the session's handoff record: if the work is still uncommitted when the next session starts, that session reads up to five open items in plain words. `lessloc check` shows them, and in CI each one becomes a notice on the pull request (see [commits and CI](/guide/ci)). Looser matches are notes too: `near-copy` (75% or more the same code), `similar-name`, and `repeated-literal` for a format, regex or query copied out of the function that owns it. So are `long-params` (8 or more parameters), `single-impl`, `wrapper` (a function that only forwards) and `vague-name`.

Why, of these, only `copy` holds a turn:

- A hold costs a whole extra turn, and a wrong one buys nothing. See [why your agent bill grows](/guides/costs).
- Replaying commits that humans already merged shows how often a kind fires on finished work: `copy` fired mostly on code repeated verbatim ([Benchmarks](/benchmarks#precision-on-code-humans-merged-without-a-model-bench-replay-mjs)).
- Whether a deep `if` or a long function should be split depends on the code around it, so these stay notes.

The notes also guard against going too far the other way. The `long-function` note asks to split code "where it does several things, not into one-line helpers". The `single-use` note asks to inline a one-line helper "unless its name says something the line cannot". And `clever` is the counterweight to `simpler`, lessloc's check for brute-force idioms, so shorter never means golfed.

What you can do:

- Ask for the shape in the prompt: "reshape first, then change", "put the rates in a table", "keep the parsing out of the pricing".
- Read the notes before you merge, with `lessloc check` or in the CI annotations.
- Make a kind hold the turn by listing it in [`interrupt`](/guide/configuration#interrupt) in `.lessloc.json`, keeping the defaults in it. The agent can answer any hold in one line.
- When a refactor and a feature go in one prompt, ask for the feature's test yourself. A prompt that says refactor (or restructure, simplify, clean up, consolidate, reorganize, dedupe) turns off lessloc's check for new behavior without a test, for that whole turn.

The [patterns](/patterns/) pages give the standard behind each kind, with examples.
