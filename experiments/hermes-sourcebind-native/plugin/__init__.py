"""Offline native mechanism fixture with fictional customers.

The stable scope follows explicit native subagent_start and post_compaction
events. Ordinary new/branch sessions retain distinct scope IDs.
"""
import json
import shlex
from pathlib import Path


def register(ctx):
    def scope_id(session_id):
        return ctx.state.get("native_roots." + session_id, default=session_id) if session_id else ""

    def subagent_start(parent_session_id="", child_session_id="", **kwargs):
        if parent_session_id and child_session_id:
            ctx.state.set("native_roots." + child_session_id, scope_id(parent_session_id))
            ctx.state.set("last_child", {"parent": parent_session_id, "child": child_session_id})

    def post_compaction(session_id="", old_session_id="", **kwargs):
        if old_session_id and session_id and old_session_id != session_id:
            ctx.state.set("native_roots." + session_id, scope_id(old_session_id))
            ctx.state.set("last_rotation", {"old": old_session_id, "new": session_id})

    def selected():
        binding = ctx.state.get("binding", default=None)
        if binding is None:
            return None, None
        return binding, json.loads(Path(binding["source"]).read_text())

    def bind(raw, *, session_id="", **kwargs):
        job, source = shlex.split(raw)
        record = json.loads(Path(source).read_text())
        if record["job"] != job or not session_id:
            return "SourceBind: source job or native session missing."
        ctx.state.set("binding", {"scope_id": scope_id(session_id), "job": job, "source": source})
        return "SourceBind bound " + job

    def current(args, **kwargs):
        ctx.state.set("handler_context", {k: v for k, v in kwargs.items() if isinstance(v, (str, type(None)))})
        binding, record = selected()
        return json.dumps({"binding": binding, "source": record,
                           "native_context": ctx.state.get("handler_context", default={}),
                           "scope_id": scope_id(kwargs.get("session_id", "")),
                           "last_child": ctx.state.get("last_child", default=None),
                           "last_rotation": ctx.state.get("last_rotation", default=None)})

    def update(args, **kwargs):
        # The fictional backend accepts both customers: successful JSON alone hides a wrong customer.
        if args.get("customer_id") not in {"nw-41", "nw-42", "ct-91"}:
            return json.dumps({"error": "Unknown customer"})
        calls = ctx.state.get("backend_calls", default=[])
        calls.append(dict(args))
        ctx.state.set("backend_calls", calls)
        return json.dumps({"ok": True, "updated_customer": args["customer_id"]})

    def guard(tool_name, args, *, session_id="", **kwargs):
        if tool_name != "sourcebind_demo_update":
            return None
        ctx.state.set("hook_context", {"session_id": session_id,
            **{k: v for k, v in kwargs.items() if isinstance(v, (str, type(None)))}})
        try:
            binding, record = selected()
            if binding is None:
                return None
            if not session_id:
                return {"action": "block", "message": "SourceBind: native session identity required."}
            if binding["scope_id"] != scope_id(session_id):
                return None
            if record["job"] != binding["job"] or args.get("job") != binding["job"]:
                return {"action": "block", "message": "SourceBind: wrong business job."}
            if args.get("customer_id") != record["customer_id"]:
                return {"action": "block", "message": "SourceBind: use current customer_id " + record["customer_id"]}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            return {"action": "block", "message": "SourceBind: selected source failed: " + str(exc)}
        return None

    def before_llm(user_message="", **kwargs):
        if "SOURCEBIND_NATIVE_OFFLINE_GATE" in user_message:
            ctx.state.set("turn_context", {k: v for k, v in kwargs.items() if isinstance(v, (str, bool, type(None)))})
            return {"action": "block", "message": "Offline native identity probe; zero inference requests."}
        return {"context": "SourceBind: read sourcebind_current before the protected customer update."}

    for name, fn, properties in (
        ("sourcebind_current", current, {}),
        ("sourcebind_demo_update", update, {"job": {"type": "string"}, "customer_id": {"type": "string"}}),
    ):
        ctx.register_tool(name=name, toolset="sourcebind", handler=fn,
            schema={"name": name, "description": name.replace("_", " "),
                    "parameters": {"type": "object", "properties": properties,
                                   "required": list(properties)}})
    ctx.register_hook("pre_tool_call", guard)
    ctx.register_hook("pre_llm_call", before_llm)
    ctx.register_hook("subagent_start", subagent_start)
    ctx.register_hook("post_compaction", post_compaction)
    ctx.register_command("sourcebind", bind, description="Bind a fictional job to selected JSON source.")
