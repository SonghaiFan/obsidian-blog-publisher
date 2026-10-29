import { describe, expect, it, vi } from "vitest";
import { articleUrl, publicChanges } from "../src/blog/model";
import { BlogService } from "../src/blog/service";
import type ObsidianGit from "../src/main";
import { PromiseQueue } from "../src/promiseQueue";
import { createSimpleGitTestContext } from "./helpers/simpleGit";

function setup() {
    const host = {
        settings: {},
        app: { plugins: { enabledPlugins: new Set<string>() } },
        localStorage: { setPausedAutomatics: vi.fn() },
        automaticsManager: { unload: vi.fn() },
        promiseQueue: new PromiseQueue(),
        displayError: vi.fn(),
    };
    const service = new BlogService(host as unknown as ObsidianGit);
    vi.spyOn(service, "identity").mockResolvedValue();
    const build = vi.spyOn(service, "build").mockResolvedValue();
    const run = vi.spyOn(service, "run").mockImplementation((_cmd, args) => {
        if (args[0] === "rev-parse") return Promise.resolve("abc\n");
        if (args[0] === "diff" && args.includes("@{upstream}"))
            return Promise.resolve("Blog/post.md\0");
        return Promise.resolve("");
    });
    return { host, service, build, run };
}
describe("Blog Publisher integration", () => {
    it("maps bilingual articles and rejects private notes", () => {
        expect(
            articleUrl("Blog/中文.md", "hello", "https://blog.example")
        ).toBe("https://blog.example/zh/blog/posts/hello");
        expect(
            articleUrl(
                "Blog/en/projects/demo.md",
                undefined,
                "https://blog.example"
            )
        ).toBe("https://blog.example/projects/demo");
        expect(() =>
            articleUrl("Daily/private.md", "hello", "https://blog.example")
        ).toThrow();
        expect(publicChanges(["Notes/private.md"])).toBe(false);
    });
    it("builds public commits before allowing push", async () => {
        const { service, build } = setup();
        await service.beforePush();
        expect(build).toHaveBeenCalledOnce();
    });
    it("does not build private-only backup commits", async () => {
        const { service, build, run } = setup();
        run.mockResolvedValue("Notes/private.md\0");
        await service.beforePush();
        expect(build).not.toHaveBeenCalled();
    });
    it("pauses automatic routines if validation fails", async () => {
        const { host, service, build } = setup();
        build.mockRejectedValue(new Error("bad build"));
        await expect(service.beforePush()).rejects.toThrow("bad build");
        expect(host.localStorage.setPausedAutomatics).toHaveBeenCalledWith(
            true
        );
        expect(host.automaticsManager.unload).toHaveBeenCalledOnce();
    });
    it("rejects a dirty public working tree before building", async () => {
        const { service, build, run } = setup();
        run.mockResolvedValue("Blog/post.md\0");
        await expect(service.beforePush()).rejects.toThrow("未提交");
        expect(build).not.toHaveBeenCalled();
    });
    it("rejects public symlinks", async () => {
        const { service, run } = setup();
        const original = run.getMockImplementation()!;
        run.mockImplementation((cmd, args) =>
            args[0] === "ls-tree"
                ? Promise.resolve("120000 blob abc\tBlog/leak.md")
                : original(cmd, args)
        );
        await expect(service.beforePush()).rejects.toThrow("符号链接");
    });
    it("rejects commits changed during a build", async () => {
        const { service, build, run } = setup();
        const original = run.getMockImplementation()!;
        build.mockImplementation(() => {
            run.mockImplementation((cmd, args) =>
                args[0] === "rev-parse"
                    ? Promise.resolve("changed")
                    : original(cmd, args)
            );
            return Promise.resolve();
        });
        await expect(service.beforePush()).rejects.toThrow("变化");
    });
    it("refuses writes when the old plugin is enabled or after unload", () => {
        const { service, host } = setup();
        host.app.plugins.enabledPlugins.add("obsidian-git");
        expect(() => service.assertOwner()).toThrow("同时");
        host.app.plugins.enabledPlugins.clear();
        service.dispose();
        expect(() => service.assertOwner()).toThrow("卸载");
    });
    it("shares the upstream queue with Git operations", async () => {
        const { service, host } = setup();
        const order: string[] = [];
        let release!: () => void;
        host.promiseQueue.addTask(async () => {
            order.push("git");
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        });
        const done = new Promise<void>((resolve) =>
            service.queue(() => {
                order.push("blog");
                resolve();
                return Promise.resolve();
            })
        );
        await Promise.resolve();
        expect(order).toEqual(["git"]);
        release();
        await done;
        expect(order).toEqual(["git", "blog"]);
    });
    it("native upstream push calls the blog gate before contacting the remote", async () => {
        const context = await createSimpleGitTestContext();
        try {
            const beforePush = vi
                .fn()
                .mockRejectedValue(new Error("blocked by blog build"));
            (context.plugin as unknown as { blog: unknown }).blog = {
                assertOwner: vi.fn(),
                beforePush,
            };
            const nativePush = vi.spyOn(context.manager.git, "push");
            await expect(context.manager.push()).rejects.toThrow(
                "blocked by blog build"
            );
            expect(beforePush).toHaveBeenCalledOnce();
            expect(nativePush).not.toHaveBeenCalled();
        } finally {
            context.cleanup();
        }
    });
});
