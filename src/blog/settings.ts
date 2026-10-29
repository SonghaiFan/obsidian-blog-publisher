import * as path from "path";
import type { App, SettingDefinitionItem } from "obsidian";
import type ObsidianGit from "../main";
import { ObsidianGitSettingsTab } from "../setting/settings";
import { BLOG_DEFAULTS } from "./model";

export class PublisherSettingsTab extends ObsidianGitSettingsTab {
    constructor(
        app: App,
        private host: ObsidianGit
    ) {
        super(app, host);
    }
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: "Blog Publisher",
                desc: "写作、预览与发布。完整 Git 功能可在高级设置和命令面板中使用。",
            },
            {
                name: "公开发布目录",
                desc: "配置文章、英文、项目、附件和私人笔记目录。默认沿用现有规范。",
                render: (setting) => {
                    setting.addButton((b) =>
                        b
                            .setButtonText("设置目录")
                            .onClick(() => this.host.blog.editPublishing())
                    );
                },
            },
            {
                name: "自动同步间隔（分钟）",
                desc: "0 表示关闭。同步使用上游队列；涉及公开内容的推送须通过博客构建。",
                control: {
                    type: "number",
                    key: "autoSaveInterval",
                    min: 0,
                    step: 1,
                },
            },
            ...(
                [
                    ["websitePath", "Website 目录"],
                    ["nodePath", "Node 可执行文件"],
                    ["repository", "私有知识库仓库"],
                    ["account", "GitHub 账号"],
                    ["blogUrl", "博客网址"],
                ] as const
            ).map(([key, name]) => ({
                name,
                control: { type: "text" as const, key: `blog.${key}` },
            })),
            {
                type: "page",
                name: "高级 Git 设置",
                desc: "上游自动同步、分支、差异、历史、编辑器和身份配置。",
                items: super.getSettingDefinitions(),
            },
        ];
    }
    getControlValue(key: string): unknown {
        if (key === "blog.websitePath")
            return (
                this.host.blog.config.websitePath ||
                path.resolve(this.host.blog.root, "../Projects/website")
            );
        if (key.startsWith("blog."))
            return this.host.blog.config[
                key.slice(5) as keyof typeof BLOG_DEFAULTS
            ];
        return super.getControlValue(key);
    }
    async setControlValue(key: string, value: unknown): Promise<void> {
        if (key.startsWith("blog.")) {
            this.host.settings.blog = {
                ...this.host.blog.config,
                [key.slice(5)]: String(value).trim(),
            };
            await this.host.saveSettings();
        } else await super.setControlValue(key, value);
    }
}
