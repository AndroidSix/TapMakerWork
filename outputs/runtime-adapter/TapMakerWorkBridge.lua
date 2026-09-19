-- TapMakerWork Runtime Dev Bridge (LOCAL ONLY — do not commit)
-- Dual channel:
--  1) Maker HttpClient (blocked until TapTap URL whitelist includes 127.0.0.1:43121)
--  2) Maker File sandbox channel (works offline; Bridge polls savedata/tapmakerwork/)

local Bridge = {}

local STATUS_PATH = "tapmakerwork/runtime-status.json"
local SNAPSHOT_PATH = "tapmakerwork/runtime-snapshot.json"
local COMMANDS_PATH = "tapmakerwork/ide-commands.json"

local state = {
    url = "http://127.0.0.1:43121",
    sessionId = nil,
    rootProvider = nil,
    cursor = 0,
    elapsed = 0,
    snapshotElapsed = 0,
    snapshotInterval = 2.0,
    pollInterval = 0.15,
    requestPending = false,
    widgetById = {},
    nextWidgetId = 0,
    revision = 0,
    started = false,
    transport = "file",
    lastHttpError = nil,
}

local METHOD = {
    GET = HTTP_GET,
    POST = HTTP_POST,
}

local jsonSafe

jsonSafe = function(value, depth, seen)
    depth = depth or 0
    seen = seen or {}
    local kind = type(value)
    if kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then return 0 end
        return value
    end
    if kind == "string" then
        if #value > 500 then return value:sub(1, 500) .. "..." end
        return value
    end
    if kind == "function" then return { ["$expression"] = "<function>" } end
    if kind == "userdata" or kind == "thread" then return { ["$expression"] = "<" .. kind .. ">" } end
    if kind ~= "table" then return { ["$expression"] = "<" .. kind .. ">" } end
    if depth > 7 or seen[value] then return { ["$expression"] = "<cycle>" } end
    seen[value] = true
    local out = {}
    local count = 0
    for key, item in pairs(value) do
        count = count + 1
        if count > 80 then
            out["$truncated"] = true
            break
        end
        local k = key
        if type(k) == "number" then
            -- keep array part
        elseif type(k) == "string" then
            if #k > 80 then k = k:sub(1, 80) end
        else
            k = tostring(k)
        end
        out[k] = jsonSafe(item, depth + 1, seen)
    end
    seen[value] = nil
    return out
end

local function widgetId(widget, pathId)
    if widget.__tapmakerworkId then return widget.__tapmakerworkId end
    state.nextWidgetId = state.nextWidgetId + 1
    local explicit = widget.props and widget.props.id
    if explicit and type(explicit) == "string" and explicit ~= "" then
        widget.__tapmakerworkId = explicit
        return explicit
    end
    local source = tostring(widget._sourceFile or "runtime") .. ":" .. tostring(widget._sourceLine or 0)
    widget.__tapmakerworkId = source .. ":" .. tostring(widget._className or "Widget") .. ":" .. (pathId or state.nextWidgetId)
    return widget.__tapmakerworkId
end

local KEEP_PROP = {
    id = true, text = true, visible = true, position = true,
    width = true, height = true, minWidth = true, minHeight = true, maxWidth = true, maxHeight = true,
    left = true, top = true, right = true, bottom = true,
    flexDirection = true, justifyContent = true, alignItems = true, alignSelf = true,
    gap = true, padding = true, paddingTop = true, paddingBottom = true, paddingLeft = true, paddingRight = true,
    margin = true, marginTop = true, marginBottom = true, marginLeft = true, marginRight = true,
    backgroundColor = true, backgroundImage = true, borderRadius = true,
    fontSize = true, fontWeight = true, fontColor = true, textColor = true, color = true,
    opacity = true, zIndex = true, flexGrow = true, flexShrink = true, flexBasis = true,
    ["$layout"] = true,
}

local function filterProps(raw)
    local props = {}
    if type(raw) ~= "table" then return props end
    for key, value in pairs(raw) do
        if type(key) == "string" and KEEP_PROP[key] then
            props[key] = jsonSafe(value, 0, {})
        end
    end
    return props
end

local function snapshotWidget(widget, pathId, depth)
    depth = depth or 0
    if type(widget) ~= "table" then
        return {
            id = "invalid:" .. tostring(pathId),
            type = "Invalid",
            name = tostring(widget),
            props = {},
            children = {},
        }
    end
    local id = widgetId(widget, pathId)
    state.widgetById[id] = widget
    local children = {}
    if depth < 4 then
        local rawChildren = widget.children
        if type(rawChildren) == "table" then
            local index = 0
            for _, child in pairs(rawChildren) do
                if type(child) == "table" then
                    index = index + 1
                    if index > 8 then break end
                    children[index] = snapshotWidget(child, (pathId or "0") .. "." .. index, depth + 1)
                end
            end
        end
    end
    local props = filterProps(widget.props)
    pcall(function()
        if widget.GetLayout then
            local layout = widget:GetLayout()
            if layout then props["$layout"] = jsonSafe(layout, 0, {}) end
        end
    end)
    return {
        id = id,
        type = tostring(widget._className or "Widget"),
        name = (widget.props and widget.props.id) or tostring(widget._className or "Widget"),
        props = props,
        source = {
            file = tostring(widget._sourceFile or "runtime"),
            line = tonumber(widget._sourceLine) or 0
        },
        children = children,
    }
end

local function makeSnapshot()
    local okRoot, root = pcall(function()
        if state.rootProvider then return state.rootProvider() end
        return nil
    end)
    if not okRoot then
        state.lastError = "rootProvider_failed:" .. tostring(root)
        return nil
    end
    if type(root) ~= "table" then
        state.lastError = "root_not_table:" .. type(root)
        return nil
    end
    state.widgetById = {}
    state.revision = state.revision + 1
    local okSnap, node = pcall(snapshotWidget, root)
    if not okSnap then
        state.lastError = "snapshot_failed:" .. tostring(node)
        return nil
    end
    if type(node) ~= "table" then
        state.lastError = "node_invalid"
        return nil
    end
    state.lastError = nil
    return { revision = state.revision, root = node }
end

local function findBySourceLine(root, file, line, depth)
    if type(root) ~= "table" or (depth or 0) > 12 then return nil end
    line = tonumber(line) or -1
    if line > 0 and tostring(root._sourceFile or "") == tostring(file or "") and tonumber(root._sourceLine) == line then
        return root
    end
    local children = root.children
    if type(children) == "table" then
        for _, child in ipairs(children) do
            local found = findBySourceLine(child, file, line, (depth or 0) + 1)
            if found then return found end
        end
    end
    return nil
end

local function applyPatch(patch)
    if not patch then return false, "no_patch" end
    local nodeId = patch.nodeId
    local widget = state.widgetById[nodeId]
    if not widget and type(nodeId) == "string" then
        local okFind, found = pcall(function()
            local UI = require("urhox-libs/UI")
            if UI and UI.FindById then return UI.FindById(nodeId) end
            return nil
        end)
        if okFind then widget = found end
    end
    if not widget and patch.source then
        local okRoot, root = pcall(function()
            if state.rootProvider then return state.rootProvider() end
            return nil
        end)
        if okRoot then
            widget = findBySourceLine(root, patch.source.file, patch.source.line)
        end
    end
    if not widget then return false, "node_not_found:" .. tostring(nodeId) end
    local props = patch.props or {}
    local style = {}
    for key, value in pairs(props) do
        if type(key) == "string"
            and not key:match("^%$")
            and key ~= "source"
            and key ~= "$factory"
            and key ~= "visible"
            and value ~= nil
        then
            -- 禁止把 0 尺寸/错误 layout 写进真机
            if key == "width" or key == "height" or key == "left" or key == "top" then
                if type(value) == "number" and value == 0 then
                    -- skip
                else
                    style[key] = value
                end
            else
                style[key] = value
            end
        end
    end
    local ok, err = pcall(function() widget:SetStyle(style) end)
    if not ok then return false, tostring(err) end
    state.lastPatch = { nodeId = nodeId, ok = true, at = os.time() }
    return true
end

local function applySnapshotNode(node)
    -- 整树 replace 容易用 IDE 的 IR/未布局数据打坏真机 UI，M0 只记录不应用
    return
end

local function handleCommandList(commands)
    local applied = 0
    for _, command in ipairs(commands or {}) do
        if command.type == "ui.patch" then
            local ok = applyPatch(command.patch)
            if ok then applied = applied + 1 end
        elseif command.type == "ui.replace" then
            applySnapshotNode(command.snapshot and command.snapshot.root)
        end
        state.cursor = math.max(state.cursor, tonumber(command.id) or state.cursor)
    end
    if applied > 0 then
        state.lastPatchCount = (state.lastPatchCount or 0) + applied
    end
end

local function fileApi()
    local okFile, FileClass = pcall(function() return File end)
    local okFs, fs = pcall(function() return fileSystem end)
    local okRead, FILE_READ_MODE = pcall(function() return FILE_READ end)
    local okWrite, FILE_WRITE_MODE = pcall(function() return FILE_WRITE end)
    if not okFile or not FileClass or not okRead or not okWrite then return nil end
    return {
        File = FileClass,
        fs = okFs and fs or nil,
        read = FILE_READ_MODE,
        write = FILE_WRITE_MODE,
    }
end

local function writeFileText(api, path, text)
    if not api then return false end
    if api.fs then
        pcall(function() api.fs:CreateDir("tapmakerwork") end)
        pcall(function()
            if api.fs.Delete then api.fs:Delete(path) end
            if api.fs.Remove then api.fs:Remove(path) end
        end)
    end
    local ok, file = pcall(function() return api.File(path, api.write) end)
    if not ok or file == nil then return false end
    local openOk = pcall(function() return file:IsOpen() end)
    if not openOk then
        pcall(function() file:Close() end)
        return false
    end
    local wrote = pcall(function()
        file:WriteString(text)
    end)
    pcall(function() file:Close() end)
    return wrote and true or false
end

local function readFileText(api, path)
    if not api then return nil end
    if api.fs and api.fs.FileExists then
        local existsOk, exists = pcall(function() return api.fs:FileExists(path) == true end)
        if not existsOk or not exists then return nil end
    end
    local ok, file = pcall(function() return api.File(path, api.read) end)
    if not ok or file == nil then return nil end
    local readOk, text = pcall(function() return file:ReadString() end)
    pcall(function() file:Close() end)
    if not readOk then return nil end
    return text
end

local function writeFileChunks(api, basePath, text, chunkSize)
    chunkSize = chunkSize or 180
    local total = #text
    local parts = math.ceil(total / chunkSize)
    if parts < 1 then parts = 1 end
    if parts > 250 then
        return false, "too_many_parts:" .. tostring(parts)
    end
    local meta = {
        kind = "tapmakerwork.snapshot.meta",
        parts = parts,
        total = total,
        chunkSize = chunkSize,
        sessionId = state.sessionId,
        revision = state.revision,
        updatedAt = os.time(),
    }
    local okMeta, metaJson = pcall(cjson.encode, meta)
    if not okMeta then return false, "meta_encode_failed" end
    if not writeFileText(api, basePath .. ".meta.json", metaJson) then
        return false, "meta_write_failed"
    end
    for index = 1, parts do
        local chunk = text:sub((index - 1) * chunkSize + 1, index * chunkSize)
        if not writeFileText(api, string.format("%s.part%02d", basePath, index), chunk) then
            return false, "part_write_failed:" .. tostring(index)
        end
    end
    return true, parts
end

local function writeStatusFile(includeSnapshot)
    local api = fileApi()
    if not api then return false end
    local snapshotError = nil
    local snapshotBytes = 0
    local rootType = nil
    local childCount = 0
    local wroteSnapshot = false
    local encodedOk = false
    if includeSnapshot then
        local snapshot = makeSnapshot()
        if not snapshot then
            snapshotError = state.lastError or "snapshot_nil"
        else
            rootType = snapshot.root and tostring(snapshot.root.type) or nil
            childCount = snapshot.root and #(snapshot.root.children or {}) or 0
            local okEnc, encodedSnap = pcall(cjson.encode, snapshot)
            encodedOk = okEnc and type(encodedSnap) == "string"
            if not encodedOk then
                snapshotError = "snapshot_encode_failed:" .. tostring(encodedSnap)
            else
                snapshotBytes = #encodedSnap
                local okWrite, writeInfo = writeFileChunks(api, SNAPSHOT_PATH, encodedSnap, 400)
                wroteSnapshot = okWrite and true or false
                if not wroteSnapshot then
                    snapshotError = "snapshot_write_failed:" .. tostring(writeInfo)
                else
                    state.lastSnapshotBytes = snapshotBytes
                    state.lastSnapshotParts = writeInfo
                end
            end
        end
    end
    local payload = {
        kind = "tapmakerwork.runtime.status",
        sessionId = state.sessionId,
        cursor = state.cursor,
        revision = state.revision,
        transport = state.transport,
        url = state.url,
        lastHttpError = state.lastHttpError,
        snapshotError = snapshotError or "",
        snapshotBytes = snapshotBytes,
        lastSnapshotBytes = state.lastSnapshotBytes or 0,
        rootType = rootType or "",
        childCount = childCount,
        wroteSnapshot = wroteSnapshot,
        encodedOk = encodedOk,
        hasRootProvider = state.rootProvider ~= nil,
        updatedAt = os.time(),
    }
    local ok, encoded = pcall(cjson.encode, payload)
    if not ok then return false end
    local wrote = writeFileText(api, STATUS_PATH, encoded)
    if includeSnapshot then
        writeFileText(api, "tapmakerwork/debug.txt", table.concat({
            "sessionId=" .. tostring(state.sessionId),
            "revision=" .. tostring(state.revision),
            "hasRootProvider=" .. tostring(state.rootProvider ~= nil),
            "encodedOk=" .. tostring(encodedOk),
            "wroteSnapshot=" .. tostring(wroteSnapshot),
            "snapshotError=" .. tostring(snapshotError),
            "lastError=" .. tostring(state.lastError),
            "rootType=" .. tostring(rootType),
            "childCount=" .. tostring(childCount),
            "snapshotBytes=" .. tostring(snapshotBytes),
            "hasWriteChunks=" .. tostring(writeFileChunks ~= nil),
            "updatedAt=" .. tostring(os.time()),
        }, "\n"))
    end
    return wrote
end

local function readCommandFile()
    local api = fileApi()
    if not api then return end
    local text = readFileText(api, COMMANDS_PATH)
    if not text or text == "" then return end
    local ok, value = pcall(cjson.decode, text)
    if not ok or type(value) ~= "table" then return end
    local commands = value.commands
    if type(commands) ~= "table" then return end
    handleCommandList(commands)
    writeStatusFile(false)
end

local function httpRequest(method, route, payload, callback)
    if state.requestPending then return false end
    local body = nil
    if payload ~= nil then
        local ok, encoded = pcall(cjson.encode, payload)
        if not ok then
            if callback then callback("encode_failed", nil) end
            return false
        end
        body = encoded
    end
    local transport = package.loaded["sdk.HttpTransport"]
    if not transport then
        local ok, mod = pcall(require, "sdk.HttpTransport")
        if ok then transport = mod end
    end
    if transport and transport.Request then
        state.requestPending = true
        transport.Request({
            method = method,
            url = state.url .. route,
            timeoutMs = 2000,
            headers = { ["Content-Type"] = "application/json" },
            body = body,
        }, function(err, response)
            state.requestPending = false
            state.lastHttpError = err
            if err then
                if callback then callback(err, nil) end
                return
            end
            local ok, value = pcall(cjson.decode, (response and response.body) or "{}")
            if callback then callback(ok and nil or "invalid_json", ok and value or nil) end
        end)
        return true
    end
    if callback then callback("http_client_unavailable", nil) end
    return false
end

function Bridge.PushSnapshot()
    return writeStatusFile(true)
end

function Bridge.Start(options)
    options = options or {}
    state.url = options.url or state.url
    state.rootProvider = assert(options.rootProvider, "TapMakerWorkBridge requires rootProvider")
    state.pollInterval = math.max(0.05, tonumber(options.pollInterval) or state.pollInterval)
    state.snapshotInterval = math.max(0.5, tonumber(options.snapshotInterval) or state.snapshotInterval)
    state.sessionId = options.sessionId or ("wxy-" .. tostring(os.time()))
    state.started = true
    state.transport = "file"
    writeStatusFile(true)
    httpRequest("POST", "/api/runtime/hello", { sessionId = state.sessionId, frames = false, transport = "http" }, function(err)
        if err then
            print("[TapMakerWork] HTTP hello blocked, file channel active: " .. tostring(err))
            writeStatusFile(true)
            return
        end
        state.transport = "http"
        print("[TapMakerWork] HTTP hello ok session=" .. tostring(state.sessionId))
        writeStatusFile(true)
    end)
    print("[TapMakerWork] bridge started session=" .. tostring(state.sessionId))
    writeStatusFile(true)
    return true
end

function Bridge.Update(dt)
    if not state.started then return end
    dt = tonumber(dt) or 0
    state.elapsed = state.elapsed + dt
    state.snapshotElapsed = state.snapshotElapsed + dt
    readCommandFile()
    if state.snapshotElapsed >= state.snapshotInterval then
        state.snapshotElapsed = 0
        writeStatusFile(true)
    end
    if state.elapsed < state.pollInterval then return end
    state.elapsed = 0
    if state.transport == "http" and not state.requestPending then
        httpRequest("GET", "/api/runtime/commands?cursor=" .. tostring(state.cursor), nil, function(err, value)
            if not err and value then handleCommandList(value.commands) end
        end)
    end
end

function Bridge.Diagnostics()
    return {
        sessionId = state.sessionId,
        cursor = state.cursor,
        revision = state.revision,
        requestPending = state.requestPending,
        started = state.started,
        transport = state.transport,
        lastHttpError = state.lastHttpError,
    }
end

return Bridge
