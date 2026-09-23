-- TapMakerWork NanoVG Runtime Dev Bridge
-- Proxies global nvg* draw calls into a virtual node tree for IDE live-edit.
-- Visual overrides live in *.ui.json; game Lua is not rewritten.

local Bridge = {}

local state = {
    url = "http://127.0.0.1:43121",
    sessionId = nil,
    cursor = 0,
    elapsed = 0,
    snapshotElapsed = 0,
    pollInterval = 0.1,
    snapshotInterval = 0.35,
    httpEnabled = true,
    lastHttpError = nil,
    lastCommandError = nil,
    lastCommandResult = nil,
    requestPending = false,
    revision = 0,
    hooked = false,
    originals = {},
    overridesById = {},
    overridesBySite = {},
    extraNodes = {},
    nodeById = {},
    frame = nil,
    lastCtx = nil,
    projectName = nil,
}

local METHOD = {
    GET = HTTP_GET,
    POST = HTTP_POST,
}

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
            print("[TapMakerWork] NanoVG file channel -> " .. primary)
        end
        return true
    end
    local fallback = USE_FLAT_FILES and (FILE_DIR .. "/" .. name) or ("tapmakerwork-" .. name)
    if writeTextFile(fallback, text, not USE_FLAT_FILES) then
        if not writeSuccessLogged then
            writeSuccessLogged = true
            print("[TapMakerWork] NanoVG file channel -> " .. fallback)
        end
        return true
    end
    if not writeFailureLogged then
        writeFailureLogged = true
        print("[TapMakerWork] NanoVG savedata write failed: " .. primary)
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
        backend = "nanovg",
        sessionId = state.sessionId,
        cursor = state.cursor,
        revision = state.revision,
        transport = "file+http",
        url = state.url,
        projectName = state.projectName,
        lastHttpError = state.lastHttpError,
        lastCommandError = state.lastCommandError,
        lastCommandResult = state.lastCommandResult,
        hasRootProvider = true,
        updatedAt = os.time() * 1000,
    })
    return ok and writeChannelFile("runtime-status.json", encoded)
end

local function request(method, route, payload, callback)
    if not state.httpEnabled then return false end
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
            state.httpEnabled = false
            state.lastHttpError = "json_encode_failed"
            return false
        end
        client:SetBody(encoded)
    end
    client:OnSuccess(function(_, response)
        state.requestPending = false
        local ok, value = pcall(cjson.decode, response.dataAsString or "{}")
        if callback then callback(ok and nil or "invalid_json", ok and value or nil) end
    end)
    client:OnError(function(_, status, message)
        state.requestPending = false
        state.lastHttpError = tostring(message or status or "request_failed")
        state.httpEnabled = false
        if callback then callback(tostring(message or status or "request_failed"), nil) end
    end)
    client:Send()
    return true
end

local function identity()
    return { 1, 0, 0, 1, 0, 0 }
end

local function copyMat(m)
    return { m[1], m[2], m[3], m[4], m[5], m[6] }
end

local function mulMat(a, b)
    return {
        a[1] * b[1] + a[3] * b[2],
        a[2] * b[1] + a[4] * b[2],
        a[1] * b[3] + a[3] * b[4],
        a[2] * b[3] + a[4] * b[4],
        a[1] * b[5] + a[3] * b[6] + a[5],
        a[2] * b[5] + a[4] * b[6] + a[6],
    }
end

local function transformPoint(m, x, y)
    return m[1] * x + m[3] * y + m[5], m[2] * x + m[4] * y + m[6]
end

local function transformBounds(m, x, y, w, h)
    local x0, y0 = transformPoint(m, x, y)
    local x1, y1 = transformPoint(m, x + w, y)
    local x2, y2 = transformPoint(m, x + w, y + h)
    local x3, y3 = transformPoint(m, x, y + h)
    local minX = math.min(x0, x1, x2, x3)
    local minY = math.min(y0, y1, y2, y3)
    local maxX = math.max(x0, x1, x2, x3)
    local maxY = math.max(y0, y1, y2, y3)
    return minX, minY, maxX - minX, maxY - minY
end

local function normalizeSource(source)
    if type(source) ~= "string" or source == "" then return "runtime" end
    source = source:gsub("^@", "")
    source = source:gsub("\\", "/")
    if source == "runtime" or source == "=[C]" or source:match("^%[") or source:match("^=") then
        return source
    end
    -- Absolute / package paths that already contain scripts/…
    local scripts = source:match("(scripts/.+)$")
    if scripts then
        if not scripts:match("%.lua$") then scripts = scripts .. ".lua" end
        return scripts
    end
    -- Maker require() chunk names look like "pool/ui/DrawUtil" (no scripts/, no .lua).
    if source:match("%.lua$") then
        if not source:match("^scripts/") then return "scripts/" .. source end
        return source
    end
    -- Dotted module form: pool.ui.DrawUtil
    if not source:find("/", 1, true) and source:find(".", 1, true) then
        source = source:gsub("%.", "/")
    end
    if not source:match("^scripts/") then source = "scripts/" .. source end
    return source .. ".lua"
end

local function callSite(skip)
    local info = debug.getinfo((skip or 3), "Sl")
    if not info then return "runtime", 0 end
    local file = normalizeSource(info.source or "runtime")
    local line = tonumber(info.currentline) or 0
    if file == "=[C]" or file:find("TapMakerWorkNanoVGBridge", 1, true) then
        info = debug.getinfo((skip or 3) + 1, "Sl")
        if info then
            file = normalizeSource(info.source or "runtime")
            line = tonumber(info.currentline) or 0
        end
    end
    return file, line
end

local function colorToRgba(value)
    if value == nil then return { 255, 255, 255, 255 } end
    if type(value) == "table" then
        local r = tonumber(value.r or value[1] or value.R) or 1
        local g = tonumber(value.g or value[2] or value.G) or 1
        local b = tonumber(value.b or value[3] or value.B) or 1
        local a = tonumber(value.a or value[4] or value.A) or 1
        if r <= 1 and g <= 1 and b <= 1 and a <= 1 then
            return { math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5), math.floor(b * 255 + 0.5), math.floor(a * 255 + 0.5) }
        end
        return { math.floor(r + 0.5), math.floor(g + 0.5), math.floor(b + 0.5), math.floor(a + 0.5) }
    end
    if type(value) == "userdata" then
        local ok, r, g, b, a = pcall(function()
            return value.r, value.g, value.b, value.a
        end)
        if ok then return colorToRgba({ r or 1, g or 1, b or 1, a or 1 }) end
    end
    return { 255, 255, 255, 255 }
end

local function rgbaToNvg(rgba)
    local originals = state.originals
    local r = (tonumber(rgba[1]) or 255) / 255
    local g = (tonumber(rgba[2]) or 255) / 255
    local b = (tonumber(rgba[3]) or 255) / 255
    local a = (tonumber(rgba[4]) or 255) / 255
    if originals.nvgRGBAf then return originals.nvgRGBAf(r, g, b, a) end
    if originals.nvgRGBA then
        return originals.nvgRGBA(
            math.floor(r * 255 + 0.5),
            math.floor(g * 255 + 0.5),
            math.floor(b * 255 + 0.5),
            math.floor(a * 255 + 0.5)
        )
    end
    if Color then
        local ok, color = pcall(Color, r, g, b, a)
        if ok then return color end
    end
    return { r, g, b, a }
end

local function siteKey(file, line, kind)
    return tostring(file) .. ":" .. tostring(line) .. ":" .. tostring(kind)
end

local function ensureFrame()
    if state.frame then return state.frame end
    state.frame = {
        elements = {},
        siteCounts = {},
        drawOrder = 0,
        transform = identity(),
        stack = {},
        fillColor = { 255, 255, 255, 255 },
        strokeColor = { 0, 0, 0, 255 },
        fontSize = 16,
        fontFace = "sans",
        textAlign = 0,
        path = nil,
        imagePaint = nil,
        useCtx = false,
        ctx = nil,
        width = graphics and tonumber(graphics.width) or 720,
        height = graphics and tonumber(graphics.height) or 1280,
        ratio = 1,
    }
    return state.frame
end

local function beginPathBounds()
    local frame = ensureFrame()
    frame.path = { minX = nil, minY = nil, maxX = nil, maxY = nil, kind = "Path" }
end

local function expandPath(x, y, w, h)
    local frame = ensureFrame()
    if not frame.path then beginPathBounds() end
    local path = frame.path
    local x0, y0, bw, bh = transformBounds(frame.transform, x, y, w, h)
    local x1, y1 = x0 + bw, y0 + bh
    if not path.minX then
        path.minX, path.minY, path.maxX, path.maxY = x0, y0, x1, y1
    else
        path.minX = math.min(path.minX, x0)
        path.minY = math.min(path.minY, y0)
        path.maxX = math.max(path.maxX, x1)
        path.maxY = math.max(path.maxY, y1)
    end
end

local function lookupOverride(id, file, line, kind)
    local byId = state.overridesById[id]
    if byId then return byId end
    return state.overridesBySite[siteKey(file, line, kind)]
end

local function mergeProps(base, overlay)
    if not overlay then return base end
    local next = {}
    for key, value in pairs(base or {}) do next[key] = value end
    for key, value in pairs(overlay) do
        if type(key) == "string" and key:sub(1, 1) ~= "$" and value ~= nil then
            next[key] = value
        end
    end
    return next
end

local function emitElement(kind, props, bounds)
    local frame = ensureFrame()
    local file, line = callSite(4)
    frame.drawOrder = frame.drawOrder + 1
    local key = siteKey(file, line, kind)
    frame.siteCounts[key] = (frame.siteCounts[key] or 0) + 1
    local instance = frame.siteCounts[key]
    local id = key .. ":" .. tostring(instance)
    local overlay = lookupOverride(id, file, line, kind)
    local merged = mergeProps(props, overlay)

    local x = tonumber(merged.left or merged.x) or bounds.x
    local y = tonumber(merged.top or merged.y) or bounds.y
    local w = tonumber(merged.width) or bounds.w
    local h = tonumber(merged.height) or bounds.h
    if overlay then
        if overlay.left ~= nil or overlay.x ~= nil then x = tonumber(overlay.left or overlay.x) or x end
        if overlay.top ~= nil or overlay.y ~= nil then y = tonumber(overlay.top or overlay.y) or y end
        if overlay.width ~= nil then w = tonumber(overlay.width) or w end
        if overlay.height ~= nil then h = tonumber(overlay.height) or h end
    end

    local node = {
        id = id,
        type = kind,
        name = tostring(merged.text or merged.backgroundImage or kind) .. (instance > 1 and ("#" .. instance) or ""),
        props = {
            left = x,
            top = y,
            width = w,
            height = h,
            x = x,
            y = y,
            text = merged.text,
            fontSize = merged.fontSize,
            fontFace = merged.fontFace,
            color = merged.color,
            backgroundColor = merged.backgroundColor,
            borderColor = merged.borderColor,
            backgroundImage = merged.backgroundImage,
            opacity = merged.opacity,
            visible = merged.visible ~= false,
            zIndex = frame.drawOrder,
            ["$backend"] = "nanovg",
            ["$drawOrder"] = frame.drawOrder,
            ["$instance"] = instance,
            ["$layout"] = { x = x, y = y, w = w, h = h },
            ["$screen"] = { x = x, y = y, w = w, h = h },
        },
        source = { file = file, line = line },
        children = {},
        __bounds = { x = x, y = y, w = w, h = h },
        __kind = kind,
    }
    frame.elements[#frame.elements + 1] = node
    state.nodeById[id] = node
    return node, overlay
end

local function original(name)
    return state.originals[name]
end

local function drawExtraNodes(ctx)
    local nvgBeginPath = original("nvgBeginPath")
    local nvgRect = original("nvgRect")
    local nvgFillColor = original("nvgFillColor")
    local nvgFill = original("nvgFill")
    local nvgFontSize = original("nvgFontSize")
    local nvgFontFace = original("nvgFontFace")
    local nvgText = original("nvgText")
    local function call(fn, ...)
        if not fn then return end
        if ctx ~= nil then return fn(ctx, ...) end
        return fn(...)
    end
    for _, node in ipairs(state.extraNodes) do
        if node.props and node.props.visible == false then goto continue end
        local props = node.props or {}
        local x = tonumber(props.left or props.x) or 0
        local y = tonumber(props.top or props.y) or 0
        local w = tonumber(props.width) or 100
        local h = tonumber(props.height) or 40
        local bg = props.backgroundColor or props.color
        if nvgBeginPath and nvgRect and nvgFill and bg then
            call(nvgBeginPath)
            call(nvgRect, x, y, w, h)
            call(nvgFillColor, rgbaToNvg(colorToRgba(bg)))
            call(nvgFill)
        end
        if props.text and nvgText then
            call(nvgFontSize, tonumber(props.fontSize) or 18)
            if props.fontFace then call(nvgFontFace, props.fontFace) end
            if props.color then call(nvgFillColor, rgbaToNvg(colorToRgba(props.color))) end
            call(nvgText, x + 8, y + (tonumber(props.fontSize) or 18), tostring(props.text))
        end
        ::continue::
    end
end

local function makeSnapshot()
    local frame = state.frame or ensureFrame()
    state.revision = state.revision + 1
    local children = {}
    for _, node in ipairs(frame.elements or {}) do
        children[#children + 1] = {
            id = node.id,
            type = node.type,
            name = node.name,
            props = node.props,
            source = node.source,
            children = {},
        }
    end
    for _, node in ipairs(state.extraNodes) do
        local props = mergeProps(node.props or {}, state.overridesById[node.id])
        local x = tonumber(props.left or props.x) or 0
        local y = tonumber(props.top or props.y) or 0
        local w = tonumber(props.width) or 100
        local h = tonumber(props.height) or 40
        children[#children + 1] = {
            id = node.id,
            type = node.type or "Panel",
            name = node.name or "Visual",
            props = mergeProps(props, {
                ["$layout"] = { x = x, y = y, w = w, h = h },
                ["$screen"] = { x = x, y = y, w = w, h = h },
                ["$backend"] = "nanovg",
                ["$visualOnly"] = true,
            }),
            source = node.source or { file = "runtime", line = 0 },
            children = {},
        }
    end
    local width = tonumber(frame.width) or (graphics and tonumber(graphics.width)) or 720
    local height = tonumber(frame.height) or (graphics and tonumber(graphics.height)) or 1280
    return {
        revision = state.revision,
        backend = "nanovg",
        root = {
            id = "nanovg-root",
            type = "NanoVG",
            name = "NanoVG",
            props = {
                width = width,
                height = height,
                ["$layout"] = { x = 0, y = 0, w = width, h = height },
                ["$screen"] = { x = 0, y = 0, w = width, h = height },
                ["$backend"] = "nanovg",
            },
            source = { file = "runtime", line = 0 },
            children = children,
        },
        viewport = {
            width = width,
            height = height,
            scale = 1,
            physicalWidth = width,
            physicalHeight = height,
        },
    }
end

function Bridge.PushSnapshot()
    local snapshot = makeSnapshot()
    local encodedOk, encoded = pcall(cjson.encode, snapshot)
    local wrote = encodedOk and writeChannelFile("runtime-snapshot.json", encoded)
    writeStatus()
    local sent = request("POST", "/api/runtime/snapshot", { snapshot = snapshot })
    return wrote or sent
end

local function applyPatch(patch)
    if not patch or not patch.nodeId then return false, "node_not_found" end
    local props = {}
    for key, value in pairs(patch.props or {}) do
        if type(key) == "string" and key:sub(1, 1) ~= "$" then props[key] = value end
    end
    state.overridesById[patch.nodeId] = mergeProps(state.overridesById[patch.nodeId], props)
    local node = state.nodeById[patch.nodeId]
    if node and node.source then
        local key = siteKey(node.source.file, node.source.line, node.type)
        state.overridesBySite[key] = mergeProps(state.overridesBySite[key], props)
    elseif patch.source and patch.source.file then
        local key = siteKey(patch.source.file, patch.source.line or 0, (node and node.type) or "Label")
        state.overridesBySite[key] = mergeProps(state.overridesBySite[key], props)
    end
    for index, extra in ipairs(state.extraNodes) do
        if extra.id == patch.nodeId then
            state.extraNodes[index].props = mergeProps(extra.props, props)
        end
    end
    state.lastCommandResult = "patch:" .. tostring(patch.nodeId)
    return true
end

local function applyTreeMutation(mutation)
    if not mutation then return false, "mutation_required" end
    if mutation.action == "delete" then
        local kept = {}
        for _, node in ipairs(state.extraNodes) do
            if node.id ~= mutation.nodeId then kept[#kept + 1] = node end
        end
        state.extraNodes = kept
        state.overridesById[mutation.nodeId] = nil
        return true
    end
    if mutation.action == "create" then
        local node = mutation.node
        if not node or not node.id then return false, "node_required" end
        node.props = node.props or {}
        node.props["$visualOnly"] = true
        node.source = node.source or { file = "runtime", line = 0 }
        state.extraNodes[#state.extraNodes + 1] = node
        state.lastCommandResult = "create:" .. tostring(node.id)
        return true
    end
    if mutation.action == "move" then
        return true
    end
    return false, "unsupported_mutation:" .. tostring(mutation.action)
end

local function applySnapshotNode(node)
    if not node then return end
    applyPatch({ nodeId = node.id, props = node.props or {}, source = node.source })
    for _, child in ipairs(node.children or {}) do applySnapshotNode(child) end
end

local function handleCommands(value)
    local changed = false
    for _, command in ipairs((value and value.commands) or {}) do
        local commandId = tonumber(command.id) or 0
        if commandId <= state.cursor then
            -- skip replay
        elseif command.type == "ui.patch" then
            local ok, err = applyPatch(command.patch)
            state.lastCommandError = ok and nil or tostring(err)
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

local function estimateTextBounds(x, y, text, fontSize)
    local value = tostring(text or "")
    local width = math.max(8, #value * fontSize * 0.55)
    local height = fontSize * 1.25
    local ox, oy, w, h = transformBounds(ensureFrame().transform, x, y - fontSize, width, height)
    return { x = ox, y = oy, w = w, h = h }
end

-- UrhoX / Maker NanoVG is context-first: nvgText(vg, x, y, text).
-- Some bindings omit the context. Support both from the same proxies.
local function frameUsesCtx()
    return state.frame and state.frame.useCtx == true
end

local function callOriginal(base, ctx, ...)
    if ctx ~= nil then return base(ctx, ...) end
    return base(...)
end

local function unpackCtxArgs(...)
    if frameUsesCtx() then
        return select(1, ...), { select(2, ...) }
    end
    local first = select(1, ...)
    if type(first) == "userdata" then
        return first, { select(2, ...) }
    end
    return nil, { ... }
end

local function installHooks()
    if state.hooked then return true end
    local names = {
        "nvgBeginFrame", "nvgEndFrame", "nvgCancelFrame",
        "nvgBeginPath", "nvgClosePath",
        "nvgMoveTo", "nvgLineTo", "nvgBezierTo", "nvgQuadTo", "nvgArcTo",
        "nvgRect", "nvgRoundedRect", "nvgEllipse", "nvgCircle", "nvgArc",
        "nvgFill", "nvgStroke",
        "nvgFillColor", "nvgStrokeColor", "nvgStrokeWidth",
        "nvgFontSize", "nvgFontFace", "nvgFontFaceId", "nvgTextAlign",
        "nvgText", "nvgTextBox",
        "nvgSave", "nvgRestore", "nvgReset", "nvgResetTransform",
        "nvgTranslate", "nvgRotate", "nvgScale", "nvgSkewX", "nvgSkewY", "nvgTransform",
        "nvgImagePattern", "nvgImagePatternTinted", "nvgGlobalAlpha",
        "nvgRGBA", "nvgRGBAf", "nvgRGB", "nvgRGBf",
    }
    for _, name in ipairs(names) do
        local fn = rawget(_G, name)
        if type(fn) == "function" then
            state.originals[name] = fn
        end
    end
    if not state.originals.nvgBeginFrame and not state.originals.nvgEndFrame then
        print("[TapMakerWork] NanoVG globals not found; bridge idle until nvg* exists")
    end

    local function wrap(name, handler)
        local base = state.originals[name]
        if type(base) ~= "function" then return end
        _G[name] = function(...)
            return handler(base, ...)
        end
    end

    wrap("nvgBeginFrame", function(base, ...)
        local a1, a2, a3, a4 = ...
        local ctx, w, h, ratio
        -- (vg, w, h, dpr) vs (w, h, dpr)
        if type(a1) ~= "number" and type(a2) == "number" then
            ctx, w, h, ratio = a1, a2, a3, a4
        else
            w, h, ratio = a1, a2, a3
        end
        state.frame = nil
        local frame = ensureFrame()
        frame.useCtx = ctx ~= nil
        frame.ctx = ctx
        state.lastCtx = ctx
        frame.width = tonumber(w) or frame.width
        frame.height = tonumber(h) or frame.height
        frame.ratio = tonumber(ratio) or 1
        state.nodeById = {}
        return callOriginal(base, ctx, w, h, ratio)
    end)

    wrap("nvgEndFrame", function(base, ...)
        local frame = ensureFrame()
        drawExtraNodes(frame.ctx or state.lastCtx)
        local result = base(...)
        Bridge.PushSnapshot()
        return result
    end)

    wrap("nvgSave", function(base, ...)
        local frame = ensureFrame()
        frame.stack[#frame.stack + 1] = {
            transform = copyMat(frame.transform),
            fillColor = { frame.fillColor[1], frame.fillColor[2], frame.fillColor[3], frame.fillColor[4] },
            strokeColor = { frame.strokeColor[1], frame.strokeColor[2], frame.strokeColor[3], frame.strokeColor[4] },
            fontSize = frame.fontSize,
            fontFace = frame.fontFace,
            textAlign = frame.textAlign,
            imagePaint = frame.imagePaint,
        }
        return base(...)
    end)

    wrap("nvgRestore", function(base, ...)
        local frame = ensureFrame()
        local saved = table.remove(frame.stack)
        if saved then
            frame.transform = saved.transform
            frame.fillColor = saved.fillColor
            frame.strokeColor = saved.strokeColor
            frame.fontSize = saved.fontSize
            frame.fontFace = saved.fontFace
            frame.textAlign = saved.textAlign
            frame.imagePaint = saved.imagePaint
        end
        return base(...)
    end)

    wrap("nvgResetTransform", function(base, ...)
        ensureFrame().transform = identity()
        return base(...)
    end)

    wrap("nvgTranslate", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local x, y = args[1], args[2]
        local frame = ensureFrame()
        frame.transform = mulMat(frame.transform, { 1, 0, 0, 1, tonumber(x) or 0, tonumber(y) or 0 })
        return callOriginal(base, ctx, x, y)
    end)

    wrap("nvgScale", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local x, y = args[1], args[2]
        local frame = ensureFrame()
        local sx = tonumber(x) or 1
        local sy = tonumber(y) or sx
        frame.transform = mulMat(frame.transform, { sx, 0, 0, sy, 0, 0 })
        return callOriginal(base, ctx, x, y)
    end)

    wrap("nvgRotate", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local angle = args[1]
        local frame = ensureFrame()
        local a = tonumber(angle) or 0
        local c, s = math.cos(a), math.sin(a)
        frame.transform = mulMat(frame.transform, { c, s, -s, c, 0, 0 })
        return callOriginal(base, ctx, angle)
    end)

    wrap("nvgFillColor", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local color = args[1]
        ensureFrame().fillColor = colorToRgba(color)
        return callOriginal(base, ctx, color)
    end)

    wrap("nvgStrokeColor", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local color = args[1]
        ensureFrame().strokeColor = colorToRgba(color)
        return callOriginal(base, ctx, color)
    end)

    wrap("nvgFontSize", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local size = args[1]
        ensureFrame().fontSize = tonumber(size) or 16
        return callOriginal(base, ctx, size)
    end)

    wrap("nvgFontFace", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local face = args[1]
        ensureFrame().fontFace = tostring(face or "sans")
        return callOriginal(base, ctx, face)
    end)

    wrap("nvgTextAlign", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local align = args[1]
        ensureFrame().textAlign = align
        return callOriginal(base, ctx, align)
    end)

    wrap("nvgBeginPath", function(base, ...)
        beginPathBounds()
        return base(...)
    end)

    wrap("nvgRect", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local x, y, w, h = args[1], args[2], args[3], args[4]
        expandPath(tonumber(x) or 0, tonumber(y) or 0, tonumber(w) or 0, tonumber(h) or 0)
        local frame = ensureFrame()
        if frame.path then frame.path.kind = "Rect" end
        return callOriginal(base, ctx, x, y, w, h)
    end)

    wrap("nvgRoundedRect", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local x, y, w, h, r = args[1], args[2], args[3], args[4], args[5]
        expandPath(tonumber(x) or 0, tonumber(y) or 0, tonumber(w) or 0, tonumber(h) or 0)
        local frame = ensureFrame()
        if frame.path then frame.path.kind = "Rect" end
        return callOriginal(base, ctx, x, y, w, h, r)
    end)

    wrap("nvgCircle", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local cx, cy, radius = args[1], args[2], args[3]
        local r = tonumber(radius) or 0
        expandPath((tonumber(cx) or 0) - r, (tonumber(cy) or 0) - r, r * 2, r * 2)
        return callOriginal(base, ctx, cx, cy, radius)
    end)

    wrap("nvgEllipse", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local cx, cy, rx, ry = args[1], args[2], args[3], args[4]
        local rax, ray = tonumber(rx) or 0, tonumber(ry) or 0
        expandPath((tonumber(cx) or 0) - rax, (tonumber(cy) or 0) - ray, rax * 2, ray * 2)
        return callOriginal(base, ctx, cx, cy, rx, ry)
    end)

    wrap("nvgImagePattern", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local ox, oy, ex, ey, angle, image, alpha = args[1], args[2], args[3], args[4], args[5], args[6], args[7]
        ensureFrame().imagePaint = {
            x = tonumber(ox) or 0,
            y = tonumber(oy) or 0,
            w = tonumber(ex) or 0,
            h = tonumber(ey) or 0,
            image = image,
            alpha = alpha,
        }
        return callOriginal(base, ctx, ox, oy, ex, ey, angle, image, alpha)
    end)

    -- Maker / UrhoX often tints table/ball art via nvgImagePatternTinted; treat like Image.
    wrap("nvgImagePatternTinted", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local ox, oy, ex, ey, angle, image, tintOrAlpha = args[1], args[2], args[3], args[4], args[5], args[6], args[7]
        ensureFrame().imagePaint = {
            x = tonumber(ox) or 0,
            y = tonumber(oy) or 0,
            w = tonumber(ex) or 0,
            h = tonumber(ey) or 0,
            image = image,
            alpha = type(tintOrAlpha) == "number" and tintOrAlpha or 1,
            tinted = true,
        }
        return callOriginal(base, ctx, ...)
    end)

    local function rebuildPath(ctx, x, y, w, h, color, colorSetter)
        local oSave, oRestore = original("nvgSave"), original("nvgRestore")
        local oReset, oBegin, oRect = original("nvgResetTransform"), original("nvgBeginPath"), original("nvgRect")
        if oSave then callOriginal(oSave, ctx) end
        if oReset then callOriginal(oReset, ctx) end
        if oBegin then callOriginal(oBegin, ctx) end
        if oRect then callOriginal(oRect, ctx, x, y, w, h) end
        if color and colorSetter then callOriginal(colorSetter, ctx, rgbaToNvg(colorToRgba(color))) end
        return oRestore
    end

    wrap("nvgFill", function(base, ...)
        local ctx = frameUsesCtx() and select(1, ...) or nil
        local frame = ensureFrame()
        local path = frame.path
        if path and path.minX then
            local kind = frame.imagePaint and "Image" or (path.kind or "Rect")
            local bounds = {
                x = path.minX,
                y = path.minY,
                w = math.max(0, path.maxX - path.minX),
                h = math.max(0, path.maxY - path.minY),
            }
            local props = {
                left = bounds.x,
                top = bounds.y,
                width = bounds.w,
                height = bounds.h,
                backgroundColor = frame.fillColor,
                color = frame.fillColor,
            }
            if frame.imagePaint then
                props.backgroundImage = tostring(frame.imagePaint.image or "")
            end
            local _, overlay = emitElement(kind, props, bounds)
            local result
            if overlay and overlay.visible == false then
                frame.path = nil
                frame.imagePaint = nil
                return nil
            end
            if overlay and (overlay.left ~= nil or overlay.x ~= nil or overlay.top ~= nil or overlay.y ~= nil
                or overlay.width ~= nil or overlay.height ~= nil or overlay.backgroundColor ~= nil or overlay.color ~= nil) then
                local x = tonumber(overlay.left or overlay.x) or bounds.x
                local y = tonumber(overlay.top or overlay.y) or bounds.y
                local w = tonumber(overlay.width) or bounds.w
                local h = tonumber(overlay.height) or bounds.h
                local oRestore = rebuildPath(ctx, x, y, w, h, overlay.backgroundColor or overlay.color, original("nvgFillColor"))
                result = callOriginal(original("nvgFill") or base, ctx)
                if oRestore then callOriginal(oRestore, ctx) end
            else
                result = base(...)
            end
            frame.path = nil
            frame.imagePaint = nil
            return result
        end
        local result = base(...)
        frame.path = nil
        frame.imagePaint = nil
        return result
    end)

    wrap("nvgStroke", function(base, ...)
        local ctx = frameUsesCtx() and select(1, ...) or nil
        local frame = ensureFrame()
        local path = frame.path
        if path and path.minX then
            local bounds = {
                x = path.minX,
                y = path.minY,
                w = math.max(0, path.maxX - path.minX),
                h = math.max(0, path.maxY - path.minY),
            }
            local props = {
                left = bounds.x,
                top = bounds.y,
                width = bounds.w,
                height = bounds.h,
                borderColor = frame.strokeColor,
                color = frame.strokeColor,
            }
            local _, overlay = emitElement("Rect", props, bounds)
            local result
            if overlay and overlay.visible == false then
                frame.path = nil
                return nil
            end
            if overlay and (overlay.left ~= nil or overlay.x ~= nil or overlay.top ~= nil or overlay.y ~= nil
                or overlay.width ~= nil or overlay.height ~= nil or overlay.borderColor ~= nil or overlay.color ~= nil) then
                local x = tonumber(overlay.left or overlay.x) or bounds.x
                local y = tonumber(overlay.top or overlay.y) or bounds.y
                local w = tonumber(overlay.width) or bounds.w
                local h = tonumber(overlay.height) or bounds.h
                local oRestore = rebuildPath(ctx, x, y, w, h, overlay.borderColor or overlay.color, original("nvgStrokeColor"))
                result = callOriginal(original("nvgStroke") or base, ctx)
                if oRestore then callOriginal(oRestore, ctx) end
            else
                result = base(...)
            end
            frame.path = nil
            return result
        end
        local result = base(...)
        frame.path = nil
        return result
    end)

    wrap("nvgText", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local x, y, text = args[1], args[2], args[3]
        local frame = ensureFrame()
        local fontSize = frame.fontSize
        local bounds = estimateTextBounds(tonumber(x) or 0, tonumber(y) or 0, text, fontSize)
        local props = {
            left = bounds.x,
            top = bounds.y,
            width = bounds.w,
            height = bounds.h,
            text = tostring(text or ""),
            fontSize = fontSize,
            fontFace = frame.fontFace,
            color = frame.fillColor,
        }
        local _, overlay = emitElement("Label", props, bounds)
        local drawX = tonumber(x) or 0
        local drawY = tonumber(y) or 0
        local drawText = text
        if overlay then
            if overlay.left ~= nil or overlay.x ~= nil or overlay.top ~= nil or overlay.y ~= nil then
                drawX = tonumber(overlay.left or overlay.x) or drawX
                drawY = (tonumber(overlay.top or overlay.y) or bounds.y) + fontSize
            end
            if overlay.text ~= nil then drawText = overlay.text end
            if overlay.fontSize ~= nil then
                callOriginal(original("nvgFontSize"), ctx, tonumber(overlay.fontSize) or fontSize)
            end
            if overlay.color ~= nil then
                callOriginal(original("nvgFillColor"), ctx, rgbaToNvg(colorToRgba(overlay.color)))
            end
        end
        return callOriginal(base, ctx, drawX, drawY, drawText)
    end)

    wrap("nvgTextBox", function(base, ...)
        local ctx, args = unpackCtxArgs(...)
        local x, y, breakWidth, text = args[1], args[2], args[3], args[4]
        local frame = ensureFrame()
        local fontSize = frame.fontSize
        local width = tonumber(breakWidth) or estimateTextBounds(0, 0, text, fontSize).w
        local height = fontSize * 1.25 * math.max(1, math.ceil(#tostring(text or "") * fontSize * 0.55 / math.max(width, 1)))
        local ox, oy, w, h = transformBounds(frame.transform, tonumber(x) or 0, (tonumber(y) or 0) - fontSize, width, height)
        local bounds = { x = ox, y = oy, w = w, h = h }
        local props = {
            left = bounds.x,
            top = bounds.y,
            width = bounds.w,
            height = bounds.h,
            text = tostring(text or ""),
            fontSize = fontSize,
            fontFace = frame.fontFace,
            color = frame.fillColor,
        }
        local _, overlay = emitElement("Label", props, bounds)
        local drawX, drawY, drawText, drawWidth = x, y, text, breakWidth
        if overlay then
            drawX = tonumber(overlay.left or overlay.x) or drawX
            drawY = (tonumber(overlay.top or overlay.y) or bounds.y) + fontSize
            if overlay.text ~= nil then drawText = overlay.text end
            if overlay.width ~= nil then drawWidth = overlay.width end
            if overlay.color ~= nil then
                callOriginal(original("nvgFillColor"), ctx, rgbaToNvg(colorToRgba(overlay.color)))
            end
        end
        return callOriginal(base, ctx, drawX, drawY, drawWidth, drawText)
    end)

    state.hooked = true
    print("[TapMakerWork] NanoVG draw proxies installed (ctx-first compatible)")
    return true
end

function Bridge.Start(options)
    options = options or {}
    state.url = options.url or state.url
    state.pollInterval = math.max(0.016, tonumber(options.pollInterval) or state.pollInterval)
    state.snapshotInterval = math.max(0.1, tonumber(options.snapshotInterval) or state.snapshotInterval)
    state.sessionId = options.sessionId or tostring(os.time())
    if type(options.projectName) == "string" and options.projectName ~= "" then
        state.projectName = options.projectName
    end
    installHooks()
    writeStatus()
    Bridge.PushSnapshot()
    request("POST", "/api/runtime/hello", { sessionId = state.sessionId, frames = false, backend = "nanovg", projectName = state.projectName })
end

function Bridge.Update(dt)
    local delta = tonumber(dt) or 0
    state.elapsed = state.elapsed + delta
    state.snapshotElapsed = state.snapshotElapsed + delta
    if not state.hooked then installHooks() end
    if state.elapsed < state.pollInterval then return end
    state.elapsed = 0
    local changed = handleFileCommands()
    if changed or state.snapshotElapsed >= state.snapshotInterval then
        state.snapshotElapsed = 0
        Bridge.PushSnapshot()
    end
    if not state.requestPending then
        request("GET", "/api/runtime/commands?cursor=" .. tostring(state.cursor), nil, function(err, value)
            if not err and handleCommands(value) then Bridge.PushSnapshot() end
        end)
    end
end

function Bridge.Diagnostics()
    return {
        sessionId = state.sessionId,
        cursor = state.cursor,
        revision = state.revision,
        backend = "nanovg",
        hooked = state.hooked,
        elementCount = state.frame and #(state.frame.elements or {}) or 0,
        requestPending = state.requestPending,
    }
end

return Bridge
