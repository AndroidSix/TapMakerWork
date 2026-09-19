-- TapMakerWork Runtime Dev Bridge
-- Export package: TapMakerWork IDE → 设置 → 导出接入包（outputs/runtime-adapter）
-- Copy into a Maker project only after reviewing the generated integration diff.
-- The host application must call Start({ rootProvider = function() ... end }) once
-- and Update(dt) from its existing update loop. No game restart is required for patches.

local Bridge = {}

local state = {
    url = "http://127.0.0.1:43121",
    sessionId = nil,
    rootProvider = nil,
    cursor = 0,
    elapsed = 0,
    pollInterval = 0.1,
    requestPending = false,
    widgetById = {},
    nextWidgetId = 0,
    revision = 0,
}

local METHOD = {
    GET = HTTP_GET,
    POST = HTTP_POST,
}

local function request(method, route, payload, callback)
    if state.requestPending then return false end
    local client = http and http:Create() or nil
    if not client then return false end
    state.requestPending = true
    client:SetUrl(state.url .. route)
        :SetMethod(METHOD[method])
        :SetTimeout(2000)
        :AddHeader("Content-Type", "application/json")
    if payload ~= nil then client:SetBody(cjson.encode(payload)) end
    client:OnSuccess(function(_, response)
        state.requestPending = false
        local ok, value = pcall(cjson.decode, response.dataAsString or "{}")
        if callback then callback(ok and nil or "invalid_json", ok and value or nil) end
    end)
    client:OnError(function(_, status, message)
        state.requestPending = false
        if callback then callback(tostring(message or status or "request_failed"), nil) end
    end)
    client:Send()
    return true
end

local function safeValue(value, depth, seen)
    local kind = type(value)
    if kind == "nil" or kind == "string" or kind == "number" or kind == "boolean" then return value end
    if kind == "function" then return { ["$expression"] = "<function>" } end
    if kind ~= "table" or depth > 6 or seen[value] then return { ["$expression"] = "<" .. kind .. ">" } end
    seen[value] = true
    local result = {}
    for key, item in pairs(value) do
        if type(key) == "string" or type(key) == "number" then result[key] = safeValue(item, depth + 1, seen) end
    end
    seen[value] = nil
    return result
end

local function widgetId(widget)
    if widget.__tapmakerworkId then return widget.__tapmakerworkId end
    state.nextWidgetId = state.nextWidgetId + 1
    local explicit = widget.props and widget.props.id
    local source = tostring(widget._sourceFile or "runtime") .. ":" .. tostring(widget._sourceLine or 0)
    widget.__tapmakerworkId = explicit or (source .. ":" .. tostring(widget._className or "Widget") .. ":" .. state.nextWidgetId)
    return widget.__tapmakerworkId
end

local function snapshotWidget(widget)
    local id = widgetId(widget)
    state.widgetById[id] = widget
    local children = {}
    for _, child in ipairs(widget.children or {}) do children[#children + 1] = snapshotWidget(child) end
    local props = safeValue(widget.props or {}, 0, {})
    local ok, layout = pcall(function() return widget:GetLayout() end)
    if ok and layout then props["$layout"] = safeValue(layout, 0, {}) end
    return {
        id = id,
        type = widget._className or "Widget",
        name = (widget.props and widget.props.id) or (widget._className or "Widget"),
        props = props,
        source = { file = widget._sourceFile or "runtime", line = widget._sourceLine or 0 },
        children = children,
    }
end

local function makeSnapshot()
    local root = state.rootProvider and state.rootProvider() or nil
    if not root then return nil end
    state.widgetById = {}
    state.revision = state.revision + 1
    return { revision = state.revision, root = snapshotWidget(root) }
end

local function applyPatch(patch)
    local widget = patch and state.widgetById[patch.nodeId] or nil
    if not widget then return false, "node_not_found" end
    local ok, err = pcall(function() widget:SetStyle(patch.props or {}) end)
    if not ok then return false, tostring(err) end
    return true
end

local function applySnapshotNode(node)
    if not node then return end
    local widget = state.widgetById[node.id]
    if widget then pcall(function() widget:SetStyle(node.props or {}) end) end
    for _, child in ipairs(node.children or {}) do applySnapshotNode(child) end
end

local function handleCommands(value)
    for _, command in ipairs((value and value.commands) or {}) do
        if command.type == "ui.patch" then applyPatch(command.patch)
        elseif command.type == "ui.replace" then applySnapshotNode(command.snapshot and command.snapshot.root) end
        state.cursor = math.max(state.cursor, tonumber(command.id) or state.cursor)
    end
end

function Bridge.PushSnapshot()
    local snapshot = makeSnapshot()
    if not snapshot then return false end
    return request("POST", "/api/runtime/snapshot", { snapshot = snapshot })
end

function Bridge.Start(options)
    options = options or {}
    state.url = options.url or state.url
    state.rootProvider = assert(options.rootProvider, "TapMakerWorkBridge requires rootProvider")
    state.pollInterval = math.max(0.016, tonumber(options.pollInterval) or state.pollInterval)
    state.sessionId = options.sessionId or tostring(os.time())
    request("POST", "/api/runtime/hello", { sessionId = state.sessionId, frames = false }, function(err)
        if not err then Bridge.PushSnapshot() end
    end)
end

function Bridge.Update(dt)
    state.elapsed = state.elapsed + (tonumber(dt) or 0)
    if state.elapsed < state.pollInterval or state.requestPending then return end
    state.elapsed = 0
    request("GET", "/api/runtime/commands?cursor=" .. tostring(state.cursor), nil, function(err, value)
        if not err then handleCommands(value) end
    end)
end

function Bridge.Diagnostics()
    return {
        sessionId = state.sessionId,
        cursor = state.cursor,
        revision = state.revision,
        requestPending = state.requestPending,
    }
end

return Bridge
