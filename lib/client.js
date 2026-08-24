window.__ModuleLoader__.load({
	id: "@abc12524/dsh-openviking",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/openviking-card-controller.ts
		/** The openviking settings namespace, spelled here (client must not import host). */
		const OPENVIKING_NS = "openviking";
		/** Field names validated as finite numbers. */
		const NUMERIC_FIELDS = /* @__PURE__ */ new Set(["minScore", "maxResults"]);
		/**
		* Bridges the `openviking` settings scope onto the card: stages edits,
		* writes them on save, and republishes whenever the scope or a draft moves.
		*/
		var OpenVikingCardController = class {
			scope;
			staged = /* @__PURE__ */ new Map();
			store;
			saving = false;
			failed = false;
			/**
			* @param scope - the bound settings scope for the `openviking` namespace.
			*/
			constructor(scope) {
				this.scope = scope;
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.projection());
				scope.subscribe(() => {
					this.store.set(this.projection());
				});
			}
			/** Build the face the card's slot registration injects. */
			inject() {
				return {
					hooks: { openvikingCard: this.store },
					edit: (field, text) => {
						this.stage(field, {
							kind: "edit",
							text
						});
					},
					resetField: (field) => {
						this.stage(field, { kind: "clear" });
					},
					save: () => {
						this.save();
					},
					discard: () => {
						this.discard();
					}
				};
			}
			/** The whole-card state: what the Host serves, and what a save would do. */
			projection() {
				const snapshot = this.scope.getSnapshot();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable === true,
					dirty: this.staged.size > 0,
					invalid: this.plan().some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed,
					fields: {
						url: this.field("url"),
						user: this.field("user"),
						key: this.field("key"),
						minScore: this.field("minScore"),
						maxResults: this.field("maxResults")
					},
					userPlaceholder: this.snapshot().value?.user ?? "default"
				};
			}
			/** One control's state: the user layer over the composition layer over the default. */
			field(field) {
				const staged = this.staged.get(field);
				if (staged !== void 0) {
					if (staged.kind === "clear") return {
						text: "",
						overridden: false,
						invalid: false
					};
					return {
						text: staged.text,
						overridden: true,
						invalid: NUMERIC_FIELDS.has(field) && !isFiniteNumber(staged.text)
					};
				}
				if (field === "key" || field === "user") return {
					text: "",
					overridden: this.overridden(field),
					invalid: false
				};
				const value = this.value(field);
				return {
					text: value === void 0 ? "" : String(value),
					overridden: this.overridden(field),
					invalid: false
				};
			}
			/** Whether the user layer carries the field (presence, not value). */
			overridden(field) {
				const user = this.snapshot().user;
				return user !== void 0 && Object.hasOwn(user, field);
			}
			/** The resolved value of one field. */
			value(field) {
				return this.snapshot().value?.[field];
			}
			snapshot() {
				return this.scope.getSnapshot();
			}
			stage(field, edit) {
				this.failed = false;
				this.staged.set(field, edit);
				this.store.set(this.projection());
			}
			discard() {
				if (this.staged.size === 0 && !this.failed) return;
				this.staged.clear();
				this.failed = false;
				this.store.set(this.projection());
			}
			/**
			* Write every staged edit, then re-seed from what the Host accepted. A
			* save that did not land keeps its drafts so the user can correct them.
			*/
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.store.set(this.projection());
				let landed = true;
				for (const write of writes) try {
					await write();
				} catch (_writeFailure) {
					landed = false;
				}
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.store.set(this.projection());
			}
			/**
			* Every staged edit a save would write; an entry whose draft is not a
			* value its field accepts carries no write — the form is still dirty, and
			* the save refuses rather than dropping the edit.
			*/
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					if (staged.kind === "clear") {
						plan.push({
							field,
							run: () => this.scope.unset(field)
						});
						continue;
					}
					const raw = staged.text.trim();
					if (raw === "") {
						plan.push({
							field,
							run: () => this.scope.unset(field)
						});
						continue;
					}
					if (NUMERIC_FIELDS.has(field)) {
						const parsed = Number(raw);
						if (!Number.isFinite(parsed)) {
							plan.push({
								field,
								run: void 0
							});
							continue;
						}
						plan.push({
							field,
							run: () => this.scope.set(field, parsed)
						});
						continue;
					}
					plan.push({
						field,
						run: () => this.scope.set(field, raw)
					});
				}
				return plan;
			}
		};
		/** Whether a draft parses as a finite number. */
		function isFiniteNumber(text) {
			return Number.isFinite(Number(text.trim()));
		}
		//#endregion
		//#region src/client/OpenVikingCard.tsx
		/**
		* OpenViking settings card, browser half: renders the OpenViking card inside
		* the Web Settings plugin-configuration surface and edits the `openviking`
		* settings namespace.
		*
		* The card draws its own chrome — a disclosure header naming the plugin and
		* what its settings govern, an unsaved badge while edits are staged, a
		* read-only banner, and a save/discard footer — because the bundle-purity
		* gate rejects value imports of the shipped card chrome across plugins. It
		* renders nothing while the namespace is unavailable, so a deployment that
		* does not serve it shows no trace of the card.
		*
		* Fields: server URL, user, key (secret), relevance threshold (minScore), and
		* result count (maxResults). The threshold/count drive the automatic
		* memory-context injection; edits land live via the settings namespace.
		*/
		/** Theme tokens (fallbacks keep the card legible off the settings shell). */
		const TOKEN = {
			label: "var(--dsw-alias-label-primary, #111)",
			labelTertiary: "var(--dsw-alias-label-tertiary, #888)",
			border: "var(--dsw-alias-border-l2, #ddd)",
			error: "var(--dsw-alias-label-error, #d33)",
			bgLayer3: "var(--dsw-alias-bg-layer-3, #fff)",
			brand: "var(--dsw-alias-brand-primary, #1677ff)"
		};
		/** Render one field row with label, override badge, and reset. */
		function Field({ id, label, hint, state, secret, placeholder, disabled, overriddenLabel, resetLabel, invalidLabel, onEdit, onReset }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { marginBottom: 14 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							alignItems: "baseline",
							gap: 8,
							marginBottom: 4
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: id,
							style: {
								fontSize: 13,
								fontWeight: 500,
								color: TOKEN.label
							},
							children: label
						}), state.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: onReset,
							disabled,
							title: resetLabel,
							style: {
								fontSize: 11,
								padding: "1px 8px",
								borderRadius: 999,
								cursor: disabled ? "default" : "pointer",
								background: "transparent",
								border: `1px solid ${TOKEN.border}`,
								color: TOKEN.labelTertiary
							},
							children: overriddenLabel
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id,
						type: secret === true ? "password" : "text",
						value: state.text,
						placeholder,
						disabled,
						onChange: (event) => onEdit(event.target.value),
						style: {
							width: "100%",
							boxSizing: "border-box",
							padding: "6px 10px",
							fontSize: 13,
							border: `1px solid ${state.invalid ? TOKEN.error : TOKEN.border}`,
							borderRadius: 8,
							background: TOKEN.bgLayer3,
							color: TOKEN.label
						}
					}),
					state.invalid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							display: "block",
							fontSize: 12,
							color: TOKEN.error,
							marginTop: 4
						},
						children: invalidLabel
					}) : null,
					hint !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							display: "block",
							fontSize: 12,
							color: TOKEN.labelTertiary,
							marginTop: 4
						},
						children: hint
					}) : null
				]
			});
		}
		/** Render the OpenViking card. */
		function OpenVikingCard({ t, ...props }) {
			const state = props.useOpenVikingCard((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			if (!state.available) return null;
			const blocked = !state.dirty || state.invalid || state.saving;
			const disabled = !state.writable;
			const field = (name) => state.fields[name];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: {
					listStyle: "none",
					border: `1px solid ${TOKEN.border}`,
					borderRadius: 12,
					background: TOKEN.bgLayer3,
					overflow: "hidden"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-expanded": open,
					onClick: () => {
						setOpen(!open);
					},
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						width: "100%",
						padding: "12px 14px",
						background: "transparent",
						border: "none",
						cursor: "pointer",
						textAlign: "left"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 2,
								flex: 1,
								minWidth: 0
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 14,
									fontWeight: 600,
									color: TOKEN.label
								},
								children: t("title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 12,
									color: TOKEN.labelTertiary
								},
								children: t("intro")
							})]
						}),
						state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 11,
								color: TOKEN.brand
							},
							children: t("unsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 12,
								color: TOKEN.labelTertiary,
								transition: "transform 120ms ease",
								transform: open ? "rotate(180deg)" : "none"
							},
							children: "▾"
						})
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { padding: "0 14px 14px" },
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							style: {
								fontSize: 12,
								color: TOKEN.labelTertiary,
								margin: "0 0 10px"
							},
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "openviking-url",
							label: t("url"),
							state: field("url"),
							disabled,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => props.edit("url", text),
							onReset: () => props.resetField("url")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "openviking-user",
							label: t("user"),
							state: field("user"),
							disabled,
							placeholder: state.userPlaceholder,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => props.edit("user", text),
							onReset: () => props.resetField("user")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "openviking-key",
							label: t("key"),
							state: field("key"),
							secret: true,
							disabled,
							placeholder: "••••••",
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => props.edit("key", text),
							onReset: () => props.resetField("key")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "openviking-minScore",
							label: t("minScore"),
							hint: t("minScoreHint"),
							state: field("minScore"),
							disabled,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => props.edit("minScore", text),
							onReset: () => props.resetField("minScore")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "openviking-maxResults",
							label: t("maxResults"),
							hint: t("maxResultsHint"),
							state: field("maxResults"),
							disabled,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => props.edit("maxResults", text),
							onReset: () => props.resetField("maxResults")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								justifyContent: "flex-end",
								gap: 8,
								marginTop: 4
							},
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "status",
									style: {
										fontSize: 12,
										color: TOKEN.error,
										margin: "auto 12px auto 0"
									},
									children: t("saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: !state.dirty || state.saving,
									onClick: props.discard,
									style: {
										padding: "6px 16px",
										borderRadius: 8,
										fontSize: 13,
										cursor: state.dirty && !state.saving ? "pointer" : "default",
										background: "transparent",
										border: `1px solid ${TOKEN.border}`,
										color: TOKEN.label
									},
									children: t("discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: blocked,
									onClick: props.save,
									style: {
										padding: "6px 16px",
										borderRadius: 8,
										fontSize: 13,
										cursor: blocked ? "default" : "pointer",
										background: TOKEN.brand,
										color: "#fff",
										border: "none"
									},
									children: t(state.saving ? "saving" : "save")
								})
							]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Chinese copy. */
		const zh = {
			title: "OpenViking 记忆",
			intro: "连接 OpenViking 记忆服务器，在每次提问时自动检索候选记忆作为背景线索注入。",
			unsaved: "未保存",
			readOnly: "本部署的设置为只读。",
			url: "服务器地址",
			user: "用户 (可选)",
			key: "API Key",
			minScore: "相关性阈值",
			minScoreHint: "仅注入相关度大于该值(0-1)的候选记忆，默认 0.4。",
			maxResults: "搜索条数",
			maxResultsHint: "每次最多注入的候选记忆条数，默认 3。",
			overridden: "已覆盖",
			reset: "重置",
			invalidNumber: "请填数字；留空表示使用默认值。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			saveFailed: "保存失败，请重试。"
		};
		/** English copy. */
		const en = {
			title: "OpenViking Memory",
			intro: "Connect an OpenViking memory server and auto-inject candidate memories as background context on every question.",
			unsaved: "Unsaved",
			readOnly: "This deployment stores settings read-only.",
			url: "Server URL",
			user: "User (optional)",
			key: "API Key",
			minScore: "Relevance threshold",
			minScoreHint: "Only inject candidates with relevance above this value (0-1); default 0.4.",
			maxResults: "Result count",
			maxResultsHint: "Maximum candidate memories injected per question; default 3.",
			overridden: "Overridden",
			reset: "Reset",
			invalidNumber: "Enter a number, or leave blank to use the default.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			saveFailed: "Save failed; please retry."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.openviking";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"connection",
			"settingsScope"
		];
		/**
		* Register the OpenViking card on the keyed `settings.plugin.item` slot.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-openviking: dictionaries");
			const controller = new OpenVikingCardController(ctx.settingsScope.bind({ namespace: OPENVIKING_NS }));
			const face = () => controller.inject();
			ctx.slots.inject("settings.plugin.item", function* () {
				yield ctx.slots.register({
					name: "settings.plugin.item",
					key: OPENVIKING_NS,
					locale: NS,
					inject: face
				}, OpenVikingCard);
			});
		}
		//#endregion
		exports.OpenVikingCard = OpenVikingCard;
		exports.OpenVikingCardController = OpenVikingCardController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map