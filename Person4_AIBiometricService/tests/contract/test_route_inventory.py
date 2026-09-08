"""The route table, verified without importing FastAPI.

``test_openapi.py`` checks the same contract against a live application, but it
needs FastAPI installed.  This module reads the source instead, so a mistyped
path, a router that was never included, or an endpoint quietly renamed is caught
even where the full toolchain is unavailable -- including in the offline runner.

It is a cheap check for an expensive class of mistake: a route that moves
without the team being told breaks Persons 1, 2 and 3 simultaneously, and does
so at integration time rather than at commit time.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[2] / "app"
ROUTERS_DIR = APP_DIR / "routers"

#: The published contract (blueprint section 03, docs/API.md).
EXPECTED_ROUTES = {
    ("GET", "/health"),
    ("GET", "/ready"),
    ("GET", "/metrics"),
    ("POST", "/v1/embed"),
    ("POST", "/v1/verify"),
    ("POST", "/v1/liveness/challenge"),
    ("POST", "/v1/security/pin/hash"),
    ("POST", "/v1/security/pin/verify"),
    ("POST", "/v1/storage/presign-put"),
    ("POST", "/v1/storage/presign-get"),
    ("POST", "/v1/admin/recalibrate"),
    ("POST", "/v1/admin/warmup"),
}

#: Reachable without a signature: a cron monitor and a browser need these.
EXPECTED_EXEMPT = {"/health", "/ready", "/docs", "/redoc", "/openapi.json"}


def _router_prefix(tree: ast.Module) -> str:
    """Read ``APIRouter(prefix=...)`` out of a module."""
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name)
            and node.value.func.id == "APIRouter"
        ):
            for keyword in node.value.keywords:
                if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant):
                    return str(keyword.value.value)
    return ""


def collect_routes() -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    for path in sorted(ROUTERS_DIR.glob("*.py")):
        if path.name == "__init__.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        prefix = _router_prefix(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                func = decorator.func
                if not (isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name)):
                    continue
                if func.value.id != "router" or func.attr not in {"get", "post", "put", "delete", "patch"}:
                    continue
                if not (decorator.args and isinstance(decorator.args[0], ast.Constant)):
                    continue
                routes.add((func.attr.upper(), prefix + str(decorator.args[0].value)))
    return routes


def included_routers() -> set[str]:
    """Which router modules ``create_app`` actually mounts."""
    tree = ast.parse((APP_DIR / "main.py").read_text(encoding="utf-8"))
    included: set[str] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "include_router"
            and node.args
            and isinstance(node.args[0], ast.Attribute)
            and isinstance(node.args[0].value, ast.Name)
        ):
            included.add(node.args[0].value.id)
    return included


def exempt_paths() -> set[str]:
    tree = ast.parse((APP_DIR / "main.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "EXEMPT_PATHS":
                    return {
                        str(element.value)
                        for element in node.value.elts  # type: ignore[attr-defined]
                        if isinstance(element, ast.Constant)
                    }
    return set()


# ------------------------------------------------------------------- tests
def test_the_route_table_matches_the_published_contract() -> None:
    actual = collect_routes()
    missing = EXPECTED_ROUTES - actual
    unexpected = actual - EXPECTED_ROUTES
    assert not missing, f"documented routes that no longer exist: {sorted(missing)}"
    assert not unexpected, (
        f"undocumented routes: {sorted(unexpected)}. "
        "Add them to docs/API.md and tell Persons 1, 2 and 3, then update this list."
    )


def test_every_router_module_is_mounted() -> None:
    """A router that exists but is never included is a 404 nobody notices."""
    modules = {p.stem for p in ROUTERS_DIR.glob("*.py") if p.name != "__init__.py"}
    assert modules <= included_routers(), f"routers defined but not mounted: {sorted(modules - included_routers())}"


def test_the_exempt_list_is_exactly_what_it_should_be() -> None:
    """Anything added here becomes reachable with no signature at all."""
    assert exempt_paths() == EXPECTED_EXEMPT


def test_no_business_endpoint_is_exempt_from_authentication() -> None:
    business = {path for method, path in EXPECTED_ROUTES if path.startswith("/v1")}
    assert not (business & exempt_paths()), "a /v1 endpoint was made unauthenticated"


def test_metrics_and_admin_are_not_exempt() -> None:
    """They carry operator data and change decision behaviour."""
    for path in ("/metrics", "/v1/admin/recalibrate", "/v1/admin/warmup"):
        assert path not in exempt_paths()


def test_admin_routes_carry_a_second_factor() -> None:
    """`X-PNSM-Admin` on top of the signature, enforced at the router."""
    source = (ROUTERS_DIR / "admin.py").read_text(encoding="utf-8")
    assert "require_admin" in source
    tree = ast.parse(source)
    prefix_guarded = False
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "APIRouter"
        ):
            for keyword in node.keywords:
                if keyword.arg == "dependencies":
                    prefix_guarded = "require_admin" in ast.dump(keyword.value)
    assert prefix_guarded, "the admin router must guard every route, not one at a time"

    metrics_source = (ROUTERS_DIR / "health.py").read_text(encoding="utf-8")
    assert "require_admin" in metrics_source, "/metrics must require the admin token"
