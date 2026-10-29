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
                desc: "基于 Obsidian Git。默认显示博客操作，完整 Git 功能保留在高级设置和命令面板。首次使用请停用原 Obsidian Git，再重新启用本插件。",
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
                    ["repository", "私有文章仓库"],
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
