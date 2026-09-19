-- TapMakerWork IDE local attach (LOCAL ONLY — gitignored, never commit)

local M = {}

local attached_ = false
local started_ = false
local bridge_ = nil

local function currentUiRoot()
    local ok, UI = pcall(require, "urhox-libs/UI")
    if ok and UI and UI.GetRoot then
        local root = UI.GetRoot()
        if root then return root end
    end
    local okShell, MainShell = pcall(require, "ui.MainShell")
    if okShell and MainShell and MainShell.GetRoot then
        local okRoot, root = pcall(MainShell.GetRoot)
        if okRoot and root then return root end
    end
    return nil
end

function M.Attach(options)
    options = options or {}
    if attached_ then return true end
    local ok, Bridge = pcall(require, "core.TapMakerWorkBridge")
    if not ok or not Bridge then
        print("[TapMakerWork] bridge module missing: " .. tostring(Bridge))
        return false
    end
    bridge_ = Bridge
    local okStart, err = pcall(function()
        Bridge.Start({
            url = options.url or "http://127.0.0.1:43121",
            pollInterval = options.pollInterval or 0.1,
            snapshotInterval = options.snapshotInterval or 2.0,
            frames = false,
            rootProvider = function()
                return currentUiRoot()
            end,
        })
    end)
    if not okStart then
        print("[TapMakerWork] bridge start failed: " .. tostring(err))
        return false
    end
    attached_ = true
    started_ = true
    print("[TapMakerWork] local IDE bridge attached → " .. tostring(options.url or "http://127.0.0.1:43121"))
    return true
end

function M.Update(dt)
    if not bridge_ then return end
    pcall(function()
        bridge_.Update(dt)
    end)
end

function M.Diagnostics()
    if bridge_ and bridge_.Diagnostics then
        return bridge_.Diagnostics()
    end
    return { attached = attached_, started = started_ }
end

return M
