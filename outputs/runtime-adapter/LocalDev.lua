-- Optional local-dev hook (gitignored). Loaded by scripts/main.lua via pcall.
-- TapMakerWork IDE installs this file; absence is a no-op for shipping builds.

local M = {}

function M.Attach()
    local ok, ide = pcall(require, "core.TapMakerWorkIdeLocal")
    if ok and ide and ide.Attach then
        return ide.Attach()
    end
    return false
end

function M.Update(dt)
    local ide = package.loaded["core.TapMakerWorkIdeLocal"]
    if ide and ide.Update then
        ide.Update(dt)
    end
end

return M
