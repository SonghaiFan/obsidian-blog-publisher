import { FileSystemAdapter, Modal, Setting, TFile, requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import type { ChildProcess } from "child_process";
import * as path from "path";
import { createConnection } from "net";
import * as fs from "fs/promises";
import type ObsidianGit from "../main";
import { articleUrl, BLOG_DEFAULTS, publicChanges } from "./model";

export class BlogService {
    private preview?: ChildProcess;
    private active = true;
    private children = new Set<ChildProcess>();
    constructor(readonly plugin: ObsidianGit) {}
    get config() {
        return { ...BLOG_DEFAULTS, ...this.plugin.settings.blog };
    }
    get root() {
        const adapter = this.plugin.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter))
            throw new Error("博客发布仅支持桌面版。");
        return adapter.getBasePath();
    }
    assertOwner() {
        if (!this.active) throw new Error("插件已卸载，操作停止。");
        const plugins = (
            this.plugin.app as unknown as {
                plugins: { enabledPlugins: Set<string> };
            }
        ).plugins;
        if (plugins.enabledPlugins.has("obsidian-git"))
            throw new Error(
                "请先停用原 Obsidian Git，再启用本插件；两者不能同时管理仓库。"
            );
    }
    activate() {
        this.active = true;
    }
    dispose() {
        this.active = false;
        this.stopPreview();
        for (const child of this.children) child.kill("SIGTERM");
        this.children.clear();
    }
    private env() {
        return {
            ...process.env,
            PATH: `${path.dirname(this.config.nodePath)}:/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}`,
            VAULT_ROOT: this.root,
            GIT_TERMINAL_PROMPT: "0",
            GH_PROMPT_DISABLED: "1",
        };
    }
    run(
        command: string,
        args: string[],
        cwd = this.root,
        timeout = 120000
    ): Promise<string> {
        this.assertOwner();
        return new Promise((resolve, reject) => {
            const child = execFile(
                command,
                args,
                { cwd, env: this.env(), timeout, maxBuffer: 8 * 1024 * 1024 },
                (error, stdout, stderr) => {
                    this.children.delete(child);
                    if (error)
                        reject(
                            new Error(
                                (stderr || stdout || error.message).slice(-3000)
                            )
                        );
                    else resolve(stdout);
                }
            );
            this.children.add(child);
        });
    }
    private git(args: string[]) {
        return this.run("git", args);
    }
    private paths(output: string) {
        return output.split("\0").filter(Boolean);
    }
    async identity() {
        this.assertOwner();
        const c = this.config;
        if (!/^[\w.-]+\/[\w.-]+$/.test(c.repository))
            throw new Error("请配置 owner/repo 格式的仓库。");
        if (
            this.plugin.settings.basePath ||
            this.plugin.settings.gitDir ||
            this.plugin.settings.updateSubmodules
        )
            throw new Error(
                "博客模式要求 Vault 根目录仓库，不启用子模块同步或独立 gitDir。"
            );
        if (
            (await this.git(["rev-parse", "--show-toplevel"])).trim() !==
            (await fs.realpath(this.root))
        )
            throw new Error("仓库根目录必须是当前 Vault。");
        if ((await this.git(["branch", "--show-current"])).trim() !== "main")
            throw new Error("博客发布只支持 main 分支。");
        const origin = (await this.git(["remote", "get-url", "origin"]))
            .trim()
            .replace(/\.git$/, "");
        if (
            ![
                `https://github.com/${c.repository}`,
                `git@github.com:${c.repository}`,
            ].includes(origin)
        )
            throw new Error("origin 与配置的文章仓库不一致。");
        if (
            (
                await this.git(["rev-parse", "--abbrev-ref", "@{upstream}"])
            ).trim() !== "origin/main"
        )
            throw new Error("main 必须跟踪 origin/main。");
        const user = (
            await this.run("gh", ["api", "user", "--jq", ".login"])
        ).trim();
        if (user !== c.account)
            throw new Error(`请将 gh 登录账号切换为 ${c.account}。`);
        const info = JSON.parse(
            await this.run("gh", [
                "api",
                `repos/${c.repository}`,
                "--jq",
                "{private: .private, full_name: .full_name}",
            ])
        ) as { private?: boolean; full_name?: string };
        if (
            !info.private ||
            info.full_name?.toLowerCase() !== c.repository.toLowerCase()
        )
            throw new Error("未确认文章仓库为私有，已停止同步。");
    }
    private async dirtyPublic() {
        return (
            publicChanges(
                this.paths(
                    await this.git(["diff", "--name-only", "-z", "HEAD", "--"])
                )
            ) ||
            publicChanges(
                this.paths(
                    await this.git([
                        "ls-files",
                        "--others",
                        "--exclude-standard",
                        "-z",
                    ])
                )
            )
        );
    }
    async beforePush() {
        try {
            await this.identity();
            const changed = this.paths(
                await this.git([
                    "diff",
                    "--name-only",
                    "-z",
                    "@{upstream}",
                    "HEAD",
                    "--",
                ])
            );
            if (publicChanges(changed)) {
                const tree = await this.git([
                    "ls-tree",
                    "-r",
                    "HEAD",
                    "--",
                    "Blog",
                    "assets",
                ]);
                if (tree.split("\n").some((line) => line.startsWith("120000 ")))
                    throw new Error("公开内容不能包含符号链接。");
                if (await this.dirtyPublic())
                    throw new Error(
                        "还有未提交的 Blog/附件修改，无法验证待推送版本。请先完成提交。"
                    );
                const head = await this.git(["rev-parse", "HEAD"]);
                await this.build();
                if (
                    head !== (await this.git(["rev-parse", "HEAD"])) ||
                    (await this.dirtyPublic())
                )
                    throw new Error("构建期间公开文件或提交变化，已停止推送。");
            }
            this.assertOwner();
        } catch (error) {
            this.plugin.localStorage.setPausedAutomatics(true);
            this.plugin.automaticsManager.unload();
            throw error;
        }
    }
    async build() {
        this.assertOwner();
        if (this.preview) throw new Error("请先停止博客预览，再检查或发布。");
        const portBusy = await new Promise<boolean>((resolve) => {
            const socket = createConnection({ host: "127.0.0.1", port: 5173 });
            const finish = (busy: boolean) => {
                socket.destroy();
                resolve(busy);
            };
            socket.once("connect", () => finish(true));
            socket.once("error", () => finish(false));
            socket.setTimeout(1000, () => finish(true));
        });
        if (portBusy)
            throw new Error(
                "5173 端口有运行中的预览，请先停止，避免覆盖预览文件。"
            );
        const website = await this.website();
        await this.run(
            this.config.nodePath,
            ["scripts/blog.mjs", "build"],
            website,
            600000
        );
    }
    private async website() {
        const website =
            this.config.websitePath ||
            path.resolve(this.root, "../Projects/website");
        if (!path.isAbsolute(website) || !path.isAbsolute(this.config.nodePath))
            throw new Error("请填写 website 与 Node 的绝对路径。");
        // Reusing the user's explicitly configured external website is the intentional integration boundary.
        const resolved = await this.run(
            this.config.nodePath,
            [
                "--input-type=module",
                "-e",
                "import {vaultRoot} from './scripts/config.mjs'; console.log(vaultRoot())",
            ],
            website
        );
        if (
            (await fs.realpath(resolved.trim())) !==
            (await fs.realpath(this.root))
        )
            throw new Error("Website 的 VAULT_ROOT 与当前 Vault 不一致。");
        return website;
    }
    private article() {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!(file instanceof TFile)) throw new Error("请打开公开文章。");
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        return {
            file,
            cache,
            url: articleUrl(
                file.path,
                cache?.frontmatter?.slug,
                this.config.blogUrl
            ),
        };
    }
    queue(action: () => Promise<unknown>) {
        this.plugin.promiseQueue.addTask(async () => {
            try {
                this.assertOwner();
                await action();
            } catch (error) {
                this.plugin.displayError(error);
            }
        });
    }
    sync() {
        this.queue(async () => {
            await this.identity();
            if (this.plugin.settings.syncMethod === "reset")
                throw new Error(
                    "博客同步不允许 reset 拉取方式，请在高级设置中改为 merge 或 rebase。"
                );
            const result = await this.plugin.gitActions.commitAndSync({
                fromAutoBackup: false,
                mode: "all",
            });
            if (result.status === "success") {
                this.plugin.localStorage.setPausedAutomatics(false);
                this.plugin.automaticsManager.reload("commit", "push", "pull");
            }
        });
    }
    check() {
        this.queue(async () => {
            const a = this.article();
            await this.build();
            this.report(
                "检查通过",
                `完整博客构建通过。\n${a.url}\n没有推送文章。`
            );
        });
    }
    publish() {
        this.queue(async () => {
            const a = this.article();
            await this.identity();
            const status = await this.plugin.updateCachedStatus();
            if (status.staged.length || status.conflicted.length)
                throw new Error("请先处理已有暂存修改或冲突。");
            if (
                (await this.git(["rev-parse", "HEAD"])).trim() !==
                (await this.git(["rev-parse", "@{upstream}"])).trim()
            )
                throw new Error("请先同步已有提交，再单独发布文章。");
            const files = [a.file.path];
            const links = (a.cache?.embeds ?? []).map((e) => e.link);
            const cover: unknown = a.cache?.frontmatter?.cover;
            if (typeof cover === "string")
                links.push(cover.replace(/^!?\[\[|\]\]$/g, "").split("|")[0]!);
            for (const link of links) {
                if (/^(https?:|data:|\/images\/|\/icons\/)/.test(link))
                    continue;
                const linked =
                    this.plugin.app.metadataCache.getFirstLinkpathDest(
                        decodeURIComponent(link.split(/[?#|]/)[0]!),
                        a.file.path
                    );
                if (!linked?.path.startsWith("assets/"))
                    throw new Error(`附件必须在 assets 内：${link}`);
                if (!files.includes(linked.path)) files.push(linked.path);
            }
            const head = await this.git(["rev-parse", "HEAD"]);
            const before = await Promise.all(
                files.map((f) => this.plugin.app.vault.adapter.readBinary(f))
            );
            const modal = new Modal(this.plugin.app);
            modal.setTitle("发布当前文章");
            modal.contentEl.createEl("p", {
                text: "仅暂存以下文件，由同一个 Git 队列提交、构建检查和推送。",
            });
            files.forEach((f) => modal.contentEl.createEl("div", { text: f }));
            new Setting(modal.contentEl).addButton((b) =>
                b
                    .setButtonText("确认发布")
                    .setCta()
                    .onClick(() => {
                        modal.close();
                        this.queue(async () => {
                            if (
                                head !==
                                    (await this.git(["rev-parse", "HEAD"])) ||
                                (await this.plugin.updateCachedStatus()).staged
                                    .length
                            )
                                throw new Error("Git 状态变化，请重新发布。");
                            for (const [i, file] of files.entries()) {
                                const data =
                                    await this.plugin.app.vault.adapter.readBinary(
                                        file
                                    );
                                if (
                                    !Buffer.from(data).equals(
                                        Buffer.from(before[i]!)
                                    )
                                )
                                    throw new Error(
                                        "确认后文件变化，请重新发布。"
                                    );
                            }
                            for (const file of files)
                                await this.plugin.gitManager.stage(file, true);
                            const committed =
                                await this.plugin.gitActions.commit({
                                    fromAuto: false,
                                    mode: "staged",
                                    commitMessage: `Publish blog: ${a.file.basename}`,
                                });
                            if (committed.status !== "success") return;
                            await this.plugin.gitActions.push();
                        });
                    })
            );
            modal.open();
        });
    }
    previewArticle() {
        this.queue(async () => {
            const a = this.article();
            if (!this.preview) {
                const website = await this.website();
                const child = spawn(
                    this.config.nodePath,
                    ["scripts/blog.mjs", "dev"],
                    {
                        cwd: website,
                        env: this.env(),
                        detached: process.platform !== "win32",
                        stdio: ["ignore", "pipe", "pipe"],
                    }
                );
                this.preview = child;
                let output = "";
                let errorOutput = "";
                child.stderr?.on("data", (b: Buffer) => {
                    errorOutput = (errorOutput + b.toString()).slice(-2000);
                });
                child.once("exit", () => {
                    if (this.preview === child) this.preview = undefined;
                });
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        this.stopPreview();
                        reject(new Error("预览启动超时。"));
                    }, 90000);
                    child.once("error", (e) => {
                        clearTimeout(timer);
                        reject(e);
                    });
                    child.once("exit", () => {
                        clearTimeout(timer);
                        reject(new Error(errorOutput || "预览已退出。"));
                    });
                    child.stdout?.on("data", (b: Buffer) => {
                        output = (output + b.toString()).slice(-4000);
                        if (output.includes("http://127.0.0.1:5173")) {
                            clearTimeout(timer);
                            resolve();
                        }
                    });
                });
            }
            const url = new URL(a.url);
            url.protocol = "http:";
            url.host = "127.0.0.1:5173";
            window.open(url.href);
        });
    }
    stopPreview() {
        if (this.preview?.pid) {
            try {
                if (process.platform === "win32") this.preview.kill();
                else process.kill(-this.preview.pid, "SIGTERM");
            } catch {
                /* Process already exited. */
            }
        }
        this.preview = undefined;
    }
    status() {
        this.queue(async () => {
            const runs = await this.run("gh", [
                "run",
                "list",
                "--repo",
                this.config.repository,
                "--workflow",
                "deploy-blog.yml",
                "--limit",
                "1",
                "--json",
                "status,conclusion,url,headSha",
            ]);
            let live = "Unknown（线上版本未验证）";
            try {
                const r = await requestUrl({
                    url: new URL(
                        `/build.json?t=${Date.now()}`,
                        this.config.blogUrl
                    ).href,
                });
                live = r.text;
            } catch {
                /* Report unknown separately from Actions. */
            }
            this.report(
                "发布状态",
                `GitHub Actions：\n${runs}\n\n线上版本：\n${live}`
            );
        });
    }
    report(title: string, text: string) {
        const m = new Modal(this.plugin.app);
        m.setTitle(title);
        m.contentEl.createEl("pre", {
            text,
            attr: { style: "white-space:pre-wrap;overflow-wrap:anywhere" },
        });
        m.open();
    }
    panel() {
        const m = new Modal(this.plugin.app);
        m.setTitle("Blog Publisher");
        for (const [label, action] of [
            ["同步", () => this.sync()],
            ["预览", () => this.previewArticle()],
            ["发布当前文章", () => this.publish()],
            ["检查文章", () => this.check()],
            ["发布状态", () => this.status()],
            ["停止预览", () => this.stopPreview()],
            [
                "改动列表",
                () =>
                    this.queue(() => this.plugin.gitActions.listChangedFiles()),
            ],
        ] as const)
            new Setting(m.contentEl).setName(label).addButton((b) =>
                b.setButtonText(label).onClick(() => {
                    m.close();
                    action();
                })
            );
        m.open();
    }
}
