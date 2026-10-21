"""Hidden tests for the long-horizon benchmark, cut from a real test file.

  slice.py cut <test file> <test name>...   prints a module with only those tests and what they need
  slice.py names <test file> <test name>... prints, one per line, the names those tests depend on from outside themselves
  slice.py changed <old file> <new file>    prints the tests that are new or changed in the new file

A test name is a function (test_x) or a method (TestY::test_x). What a test needs is found by name: the module-level imports,
assignments, functions and classes it refers to, and pytest fixtures named by its parameters, followed transitively.
"""
import ast
import sys


def defined(node):
    """Names a top-level statement binds."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return {node.name}
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        return {(a.asname or a.name).split(".")[0] for a in node.names}
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        return {n.id for t in targets for n in ast.walk(t) if isinstance(n, ast.Name)}
    if isinstance(node, (ast.If, ast.Try, ast.With)):
        inner = node.body + getattr(node, "orelse", []) + getattr(node, "finalbody", []) + [s for h in getattr(node, "handlers", []) for s in h.body]
        return set().union(*(defined(s) for s in inner)) if inner else set()
    return set()


def used(node):
    """Names a node refers to: identifiers, attribute names, and the parameters pytest fills with fixtures."""
    names = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            names.add(n.id)
        elif isinstance(n, ast.Attribute):
            names.add(n.attr)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.update(a.arg for a in n.args.args + n.args.kwonlyargs if a.arg not in ("self", "cls"))
    return names


def depends(nodes):
    """The names the code depends on from outside itself: names it imports, attributes it reads, and free names it uses. Names
    the code binds itself (its functions, classes, parameters, assignments, loop and with targets) are its own."""
    bound, free, attrs, imported = set(), set(), set(), set()
    for root in nodes:
        for n in ast.walk(root):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(n.name)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                a = n.args
                bound.update(x.arg for x in a.posonlyargs + a.args + a.kwonlyargs + [a.vararg, a.kwarg] if x)
            elif isinstance(n, ast.Name):
                (bound if isinstance(n.ctx, (ast.Store, ast.Del)) else free).add(n.id)
            elif isinstance(n, ast.Attribute):
                attrs.add(n.attr)
            elif isinstance(n, ast.ImportFrom):
                imported.update(a.name for a in n.names)
                bound.update(a.asname or a.name for a in n.names)
            elif isinstance(n, ast.Import):
                bound.update((a.asname or a.name).split(".")[0] for a in n.names)
            elif isinstance(n, ast.ExceptHandler) and n.name:
                bound.add(n.name)
            elif isinstance(n, (ast.MatchAs, ast.MatchStar)) and n.name:
                bound.add(n.name)
    return (free - bound) | attrs | imported


def is_test(name):
    return name.startswith("test")


def select(tree, wanted):
    """The top-level nodes to keep: the wanted tests (a class keeps its non-test members) and everything they need."""
    funcs = {w for w in wanted if "::" not in w}
    methods = {}
    for w in wanted:
        if "::" in w:
            cls, meth = w.split("::", 1)
            methods.setdefault(cls, set()).add(meth.split("[")[0])
    roots = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {f.split("[")[0] for f in funcs}:
            roots.append(node)
        elif isinstance(node, ast.ClassDef) and node.name in methods:
            node.body = [m for m in node.body if not (isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_test(m.name) and m.name not in methods[node.name])] or [ast.Pass()]
            roots.append(node)
    need = set().union(*(used(r) for r in roots)) if roots else set()
    chosen = {id(r) for r in roots}
    changed = True
    while changed:
        changed = False
        for node in tree.body:
            if id(node) in chosen or (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and is_test(node.name)):
                continue
            if defined(node) & (need | {"pytestmark"}) or (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)):
                chosen.add(id(node))
                need |= used(node)
                changed = True
    keep = []
    for node in tree.body:
        if id(node) not in chosen:
            continue
        # An import keeps only the names the kept code uses, so a name another task adds can never break this test.
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            node.names = [a for a in node.names if (a.asname or a.name).split(".")[0] in need]
            if not node.names:
                continue
        keep.append(node)
    return keep, roots


def tests_in(tree):
    """Each test function and test method, by name, with its source."""
    found = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_test(node.name):
            found[node.name] = ast.unparse(node)
        elif isinstance(node, ast.ClassDef):
            for m in node.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_test(m.name):
                    found[f"{node.name}::{m.name}"] = ast.unparse(m)
    return found


def main():
    mode, path, wanted = sys.argv[1], sys.argv[2], sys.argv[3:]
    if mode == "changed":
        old = tests_in(ast.parse(open(path, encoding="utf-8").read())) if path != "-" else {}
        new = tests_in(ast.parse(open(wanted[0], encoding="utf-8").read()))
        print("\n".join(name for name, src in new.items() if old.get(name) != src))
        return
    tree = ast.parse(open(path, encoding="utf-8").read())
    keep, roots = select(tree, wanted)
    if len(roots) == 0:
        sys.exit(f"none of {wanted} found in {path}")
    if mode == "cut":
        print(ast.unparse(ast.Module(body=keep, type_ignores=[])))
    else:
        print("\n".join(sorted(depends(keep))))


main()
