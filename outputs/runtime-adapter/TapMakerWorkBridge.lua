-- TapMakerWork Runtime Dev Bridge
-- Export package: TapMakerWork IDE → 设置 → 导出接入包（outputs/runtime-adapter）
-- Copy into a Maker project only after reviewing the generated integration diff.
-- The host application must call Start({ rootProvider = function() ... end }) once
-- and Update(dt) from its existing update loop. No game restart is required for patches.

-- Enable Yoga source tracking so live-edit can write props back into project Lua.
-- Must be set before UI trees are built (see urhox-libs/UI/Core/Widget.lua AddChild).
UI_INSPECTOR_ENABLED = true

local Bridge = {}

local state = {
    url = "http://127.0.0.1:43121",
    sessionId = nil,
    rootProvider = nil,
    cursor = 0,
    elapsed = 0,
    snapshotElapsed = 0,
    pollInterval = 0.1,
    snapshotInterval = 0.5,
    httpEnabled = true,
    httpCooldownUntil = 0,
    lastHttpError = nil,
    lastCommandError = nil,
    lastCommandResult = nil,
    requestPending = false,
    widgetById = {},
    nextWidgetId = 0,
    revision = 0,
    projectName = nil,
}

local METHOD = {
    GET = HTTP_GET,
    POST = HTTP_POST,
}

-- Windows savedata is a flat folder (savedata/0/*.json). Nested tapmakerwork/ writes
-- do not show up there, and Maker's HTTP whitelist blocks 127.0.0.1, so the flat
-- names are the only channel the IDE can poll.
local FILE_DIR = "tapmakerwork"
local USE_FLAT_FILES = package.config:sub(1, 1) == "\\"
local cjson = rawget(_G, "cjson")
if type(cjson) ~= "table" then
    local loadedOk, loaded = pcall(require, "cjson")
    if loadedOk and type(loaded) == "table" then cjson = loaded
    elseif type(rawget(_G, "cjson")) == "table" then cjson = rawget(_G, "cjson") end
end

local function channelPath(name)
    if USE_FLAT_FILES then return "tapmakerwork-" .. name, false end
    return FILE_DIR .. "/" .. name, true
end

local writeFailureLogged = false
local writeSuccessLogged = false

local function closeFile(file)
    if file then pcall(function() file:Close() end) end
end

local function writeTextFile(path, text, makeDir)
    if makeDir == nil then makeDir = string.find(path, "/", 1, true) ~= nil end
    if not File or not FILE_WRITE then return false end
    if makeDir and fileSystem then
        pcall(function()
            if not fileSystem:DirExists(FILE_DIR) then fileSystem:CreateDir(FILE_DIR) end
        end)
    end
    local ok, file = pcall(function() return File(path, FILE_WRITE) end)
    if not ok or not file then return false end
    local opened = false
    pcall(function() opened = file:IsOpen() == true end)
    if not opened then closeFile(file); return false end
    local wrote = pcall(function()
        file:WriteString(text)
        file:Flush()
    end)
    closeFile(file)
    return wrote
end

local function readJsonFile(path)
    if not File or not FILE_READ or not fileSystem then return nil end
    local exists = false
    pcall(function() exists = fileSystem:FileExists(path) == true end)
    if not exists then return nil end
    local ok, file = pcall(function() return File(path, FILE_READ) end)
    if not ok or not file then return nil end
    local opened = false
    pcall(function() opened = file:IsOpen() == true end)
    if not opened then closeFile(file); return nil end
    local readOk, text = pcall(function() return file:ReadString() end)
    closeFile(file)
    if not readOk or type(text) ~= "string" then return nil end
    local decodeOk, value = pcall(cjson.decode, text)
    return decodeOk and value or nil
end

local function writeChannelFile(name, text)
    local primary, makeDir = channelPath(name)
    if writeTextFile(primary, text, makeDir) then
        if not writeSuccessLogged then
            writeSuccessLogged = true
            print("[TapMakerWork] file channel -> " .. primary)
        end
        return true
    end
    local fallback = USE_FLAT_FILES and (FILE_DIR .. "/" .. name) or ("tapmakerwork-" .. name)
    if writeTextFile(fallback, text, not USE_FLAT_FILES) then
        if not writeSuccessLogged then
            writeSuccessLogged = true
            print("[TapMakerWork] file channel -> " .. fallback)
        end
        return true
    end
    if not writeFailureLogged then
        writeFailureLogged = true
        print("[TapMakerWork] savedata write failed: " .. primary)
    end
    return false
end

local function readChannelFile(name)
    local primary = channelPath(name)
    local value = readJsonFile(primary)
    if value then return value end
    local fallback = USE_FLAT_FILES and (FILE_DIR .. "/" .. name) or ("tapmakerwork-" .. name)
    return readJsonFile(fallback)
end

local function writeStatus()
    local ok, encoded = pcall(cjson.encode, {
        kind = "tapmakerwork.runtime.status",
        sessionId = state.sessionId,
        cursor = state.cursor,
        revision = state.revision,
        transport = "file+http",
        url = state.url,
        projectName = state.projectName,
        lastHttpError = state.lastHttpError,
        lastCommandError = state.lastCommandError,
        lastCommandResult = state.lastCommandResult,
        hasRootProvider = state.rootProvider ~= nil,
        updatedAt = os.time() * 1000,
    })
    return ok and writeChannelFile("runtime-status.json", encoded)
end

local function request(method, route, payload, callback)
    if not state.httpEnabled then
        local now = os.clock()
        if (state.httpCooldownUntil or 0) > now then return false end
        state.httpEnabled = true
    end
    if state.requestPending then return false end
    local client = http and http:Create() or nil
    if not client then return false end
    state.requestPending = true
    client:SetUrl(state.url .. route)
        :SetMethod(METHOD[method])
        :SetTimeout(2000)
        :AddHeader("Content-Type", "application/json")
    if payload ~= nil then
        local encodedOk, encoded = pcall(function() return cjson.encode(payload) end)
        if not encodedOk then
            state.requestPending = false
            state.lastHttpError = "json_encode_failed"
            state.httpEnabled = false
            state.httpCooldownUntil = os.clock() + 2
            return false
        end
        client:SetBody(encoded)
    end
    client:OnSuccess(function(_, response)
        state.requestPending = false
        state.lastHttpError = nil
        local ok, value = pcall(cjson.decode, response.dataAsString or "{}")
        if callback then callback(ok and nil or "invalid_json", ok and value or nil) end
    end)
    client:OnError(function(_, status, message)
        state.requestPending = false
        state.lastHttpError = tostring(message or status or "request_failed")
        state.httpEnabled = false
        state.httpCooldownUntil = os.clock() + 2
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

local function normalizeSourceFile(source)
    if type(source) ~= "string" or source == "" then return "runtime" end
    source = source:gsub("^@", "")
    source = source:gsub("\\", "/")
    if source == "runtime" or source == "=[C]" or source:match("^%[") or source:match("^=") then
        return source
    end
    local scripts = source:match("(scripts/.+)$")
    if scripts then
        if not scripts:match("%.lua$") then scripts = scripts .. ".lua" end
        return scripts
    end
    if source:match("%.lua$") then
        if not source:match("^scripts/") then return "scripts/" .. source end
        return source
    end
    if not source:find("/", 1, true) and source:find(".", 1, true) then
        source = source:gsub("%.", "/")
    end
    if not source:match("^scripts/") then source = "scripts/" .. source end
    return source .. ".lua"
end

local function widgetId(widget)
    if widget.__tapmakerworkId then return widget.__tapmakerworkId end
    state.nextWidgetId = state.nextWidgetId + 1
    local explicit = widget.props and widget.props.id
    local source = tostring(normalizeSourceFile(widget._sourceFile or "runtime")) .. ":" .. tostring(widget._sourceLine or 0)
    widget.__tapmakerworkId = explicit or (source .. ":" .. tostring(widget._className or "Widget") .. ":" .. state.nextWidgetId)
    return widget.__tapmakerworkId
end

local function snapshotWidget(widget)
    local id = widgetId(widget)
    state.widgetById[id] = widget
    local children = {}
    local seenChildren = {}
    local function appendChildren(items)
        for _, child in ipairs(items or {}) do
            if child and not seenChildren[child] then
                seenChildren[child] = true
                children[#children + 1] = snapshotWidget(child)
            end
        end
    end
    local okRender, renderChildren = pcall(function()
        return widget.GetRenderChildren and widget:GetRenderChildren() or widget.children
    end)
    appendChildren(okRender and renderChildren or widget.children)
    appendChildren(widget.bodyChildren_)
    local okHit, hitChildren = pcall(function()
        return widget.GetHitTestChildren and widget:GetHitTestChildren() or nil
    end)
    appendChildren(okHit and hitChildren or nil)
    local props = {}
    for key, value in pairs(widget.props or {}) do
        -- children contain live Widget objects and event handlers are functions;
        -- both would explode the snapshot without adding editable style data.
        if key ~= "children" and type(value) ~= "function" then
            props[key] = safeValue(value, 0, {})
        end
    end
    local ok, layout = pcall(function() return widget:GetLayout() end)
    if ok and layout then props["$layout"] = safeValue(layout, 0, {}) end
    local okScreen, screen = pcall(function()
        if widget.GetAbsoluteLayoutForHitTest then return widget:GetAbsoluteLayoutForHitTest() end
        if widget.GetAbsoluteLayout then return widget:GetAbsoluteLayout() end
        return nil
    end)
    if okScreen and screen then props["$screen"] = safeValue(screen, 0, {}) end
    local explicitId = widget.props and widget.props.id
    local title = widget.props and widget.props.title
    if type(title) ~= "string" or title == "" then title = widget.title_ end
    return {
        id = id,
        type = widget.__tapmakerworkType or widget._className or "Widget",
        name = (type(explicitId) == "string" and explicitId ~= "" and explicitId)
            or (type(title) == "string" and title ~= "" and title)
            or (widget._className or "Widget"),
        props = props,
        source = { file = normalizeSourceFile(widget._sourceFile or "runtime"), line = widget._sourceLine or 0 },
        children = children,
    }
end

local function makeSnapshot()
    local root = state.rootProvider and state.rootProvider() or nil
    if not root then return nil end
    state.widgetById = {}
    state.revision = state.revision + 1
    local scale = 1
    local okScale, value = pcall(function()
        local UI = require("urhox-libs/UI")
        return UI.GetScale and UI.GetScale() or 1
    end)
    if okScale and tonumber(value) then scale = tonumber(value) end
    local physicalWidth = graphics and tonumber(graphics.width) or 0
    local physicalHeight = graphics and tonumber(graphics.height) or 0
    return {
        revision = state.revision,
        root = snapshotWidget(root),
        viewport = {
            width = physicalWidth > 0 and physicalWidth / scale or 0,
            height = physicalHeight > 0 and physicalHeight / scale or 0,
            scale = scale,
            physicalWidth = physicalWidth,
            physicalHeight = physicalHeight,
        },
    }
end

local function applyPatch(patch)
    local widget = patch and state.widgetById[patch.nodeId] or nil
    if not widget then return false, "node_not_found" end
    local style = {}
    for key, value in pairs(patch.props or {}) do
        if type(key) == "string" and key:sub(1, 1) ~= "$" then style[key] = value end
    end
    local ok, err = pcall(function() widget:SetStyle(style) end)
    if not ok then return false, tostring(err) end
    return true
end

local function applySnapshotNode(node)
    if not node then return end
    local widget = state.widgetById[node.id]
    if widget then
        local style = {}
        for key, value in pairs(node.props or {}) do
            if type(key) == "string" and key:sub(1, 1) ~= "$" then style[key] = value end
        end
        pcall(function() widget:SetStyle(style) end)
    end
    for _, child in ipairs(node.children or {}) do applySnapshotNode(child) end
end

local function runtimeProps(node)
    local props = {}
    for key, value in pairs((node and node.props) or {}) do
        if type(key) == "string" and key:sub(1, 1) ~= "$" and key ~= "children" then
            props[key] = value
        end
    end
    return props
end

local function createRuntimeWidget(node)
    if not node then return nil, "node_required" end
    local okUI, UI = pcall(require, "urhox-libs/UI")
    if not okUI or not UI then return nil, "ui_module_unavailable" end
    local requestedType = tostring(node.type or "Panel")
    -- UrhoX UI renders ordinary images as a Panel background and uses an
    -- unpainted Panel as the transform container for editor-facing Nodes.
    local constructorType = (requestedType == "Image" or requestedType == "Node") and "Panel" or requestedType
    local constructor = UI[constructorType] or UI.Panel
    if not constructor then return nil, "widget_constructor_unavailable:" .. constructorType end
    local props = runtimeProps(node)
    if requestedType == "Image" and not props.backgroundImage then
        props.backgroundImage = props.path or props.sprite or props.image or props.texture or props.fileName or props.file
    end
    local okWidget, widget = pcall(function() return constructor(props) end)
    if not okWidget or not widget then return nil, tostring(widget or "widget_create_failed") end
    widget.__tapmakerworkId = node.id
    widget.__tapmakerworkType = requestedType
    state.widgetById[node.id] = widget
    for _, childNode in ipairs(node.children or {}) do
        local child, childError = createRuntimeWidget(childNode)
        if not child then
            pcall(function() widget:Destroy() end)
            return nil, childError
        end
        widget:AddChild(child)
    end
    return widget
end

local function forgetRuntimeWidget(widget)
    if not widget then return end
    for _, child in ipairs(widget.children or {}) do forgetRuntimeWidget(child) end
    if widget.__tapmakerworkId then state.widgetById[widget.__tapmakerworkId] = nil end
end

local function applyTreeMutation(mutation)
    if not mutation then return false, "mutation_required" end
    if mutation.action == "delete" then
        local widget = state.widgetById[mutation.nodeId]
        if not widget then return false, "node_not_found" end
        forgetRuntimeWidget(widget)
        local ok, err = pcall(function() widget:Destroy() end)
        return ok, ok and nil or tostring(err)
    end
    if mutation.action == "create" then
        local parent = state.widgetById[mutation.parentId]
        if not parent then return false, "parent_not_found" end
        local beforeCount = #(parent.children or {})
        local widget, createError = createRuntimeWidget(mutation.node)
        if not widget then return false, createError end
        local ok, err = pcall(function()
            parent:InsertChild(widget, (tonumber(mutation.index) or #parent.children) + 1)
        end)
        if not ok then
            forgetRuntimeWidget(widget)
            pcall(function() widget:Destroy() end)
            return false, tostring(err)
        end
        state.lastCommandResult = "create:" .. tostring(mutation.node.id) .. ":" .. tostring(beforeCount) .. "->" .. tostring(#(parent.children or {}))
        return true
    end
    if mutation.action == "move" then
        local widget = state.widgetById[mutation.nodeId]
        local parent = state.widgetById[mutation.parentId]
        if not widget then return false, "node_not_found" end
        if not parent then return false, "parent_not_found" end
        local ok, err = pcall(function()
            parent:InsertChild(widget, (tonumber(mutation.index) or #parent.children) + 1)
        end)
        return ok, ok and nil or tostring(err)
    end
    return false, "unsupported_mutation:" .. tostring(mutation.action)
end

local function handleCommands(value)
    local changed = false
    for _, command in ipairs((value and value.commands) or {}) do
        local commandId = tonumber(command.id) or 0
        if commandId <= state.cursor then
            -- File transport retains recent commands; never replay an already
            -- acknowledged structural edit on every polling tick.
        elseif command.type == "ui.patch" then
            local ok, err = applyPatch(command.patch)
            state.lastCommandError = ok and nil or tostring(err)
            state.lastCommandResult = ok and ("patch:" .. tostring(command.patch and command.patch.nodeId)) or nil
            changed = changed or ok
        elseif command.type == "ui.tree" then
            local ok, err = applyTreeMutation(command.mutation)
            state.lastCommandError = ok and nil or tostring(err)
            changed = changed or ok
        elseif command.type == "ui.replace" then
            applySnapshotNode(command.snapshot and command.snapshot.root)
            state.lastCommandError = nil
            state.lastCommandResult = "replace"
            changed = true
        end
        state.cursor = math.max(state.cursor, commandId)
    end
    return changed
end

local function handleFileCommands()
    local value = readChannelFile("ide-commands.json")
    if not value or (value.sessionId and value.sessionId ~= state.sessionId) then return false end
    local changed = handleCommands(value)
    if changed then writeStatus() end
    return changed
end

function Bridge.PushSnapshot()
    local snapshot = makeSnapshot()
    if not snapshot then return false end
    local encodedOk, encoded = pcall(cjson.encode, snapshot)
    local wrote = encodedOk and writeChannelFile("runtime-snapshot.json", encoded)
    writeStatus()
    local sent = request("POST", "/api/runtime/snapshot", { snapshot = snapshot })
    return wrote or sent
end

function Bridge.Start(options)
    options = options or {}
    state.url = options.url or state.url
    state.rootProvider = assert(options.rootProvider, "TapMakerWorkBridge requires rootProvider")
    state.pollInterval = math.max(0.016, tonumber(options.pollInterval) or state.pollInterval)
    state.snapshotInterval = math.max(0.1, tonumber(options.snapshotInterval) or state.snapshotInterval)
    state.sessionId = options.sessionId or tostring(os.time())
    if type(options.projectName) == "string" and options.projectName ~= "" then
        state.projectName = options.projectName
    end
    writeStatus()
    Bridge.PushSnapshot()
    request("POST", "/api/runtime/hello", { sessionId = state.sessionId, frames = false, projectName = state.projectName })
end

function Bridge.Update(dt)
    local delta = tonumber(dt) or 0
    state.elapsed = state.elapsed + delta
    state.snapshotElapsed = state.snapshotElapsed + delta
    if state.elapsed < state.pollInterval then return end
    state.elapsed = 0
    local changed = handleFileCommands()
    if not state.requestPending then
        local polled = request("GET", "/api/runtime/commands?cursor=" .. tostring(state.cursor), nil, function(err, value)
            local applied = false
            if not err then applied = handleCommands(value) end
            if applied or changed or state.snapshotElapsed >= state.snapshotInterval then
                state.snapshotElapsed = 0
                Bridge.PushSnapshot()
            end
        end)
        if polled then return end
    end
    if changed or state.snapshotElapsed >= state.snapshotInterval then
        state.snapshotElapsed = 0
        Bridge.PushSnapshot()
    end
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
