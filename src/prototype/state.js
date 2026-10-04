/* In-memory demonstration of PRD v1.4. No GitLab, model or process connection. */
const TaskFlow = (() => {
  "use strict";
  const ended = new Set(["canceled", "undelivered", "completed"]);
  const names = {
    queued: "排队中",
    running: "执行中",
    waiting: "等待输入",
    review: "待审查",
    failed: "执行失败",
    canceling: "正在取消",
    canceled: "已取消",
    undelivered: "未交付",
    completed: "已完成",
  };
  function create(input = {}) {
    return {
      id: "0142",
      title: "修复分页参数为空时接口异常",
      project: "billing",
      base: "main",
      owner: "林予安",
      creator: "林予安",
      reviewers: ["林予安", "周以宁"],
      status: "queued",
      control: "agent",
      authorized: true,
      branch: "agent/fix-0142",
      head: "demo-0001",
      commitIndex: 1,
      round: 0,
      roundConfig: 0,
      configVersion: 1,
      configReady: true,
      phase: 0,
      resource: false,
      active: false,
      attempt: 0,
      mr: null,
      mrState: "none",
      version: 0,
      hasChanges: false,
      verified: false,
      verification: "pending",
      verificationCommit: null,
      agentJudgment: "待执行",
      humanReview: null,
      feedback: "",
      feedbackHandled: false,
      pending: [],
      comments: [],
      events: [],
      answer: "",
      question: "",
      conflict: false,
      stopReason: null,
      stopUnconfirmed: false,
      stopConfirmed: true,
      cancelRequested: false,
      repairs: 0,
      executionMinutes: 0,
      limits: { repairs: 3, minutes: 30 },
      waitingHours: 0,
      reminded: false,
      snapshot: null,
      description: "分页参数为空时服务异常。",
      reproduce: "请求列表接口，分页参数留空，观察异常响应。",
      criteria: "空参数按接口约定处理；补充回归验证；已有相关检查通过。",
      constraint: "只修改参数处理与相关验证。",
      reference: "内部 Issue #238",
      created: "今天",
      updated: "刚刚",
      ...input,
    };
  }
  function manage(t, a) {
    return Boolean(a?.admin || a?.name === t.owner);
  }
  function review(t, a) {
    return Boolean(a && t.reviewers.includes(a.name));
  }
  function write(t) {
    return (
      t.authorized &&
      t.control === "agent" &&
      t.status === "running" &&
      t.active &&
      !t.conflict &&
      !ended.has(t.status) &&
      !["merged", "closed"].includes(t.mrState)
    );
  }
  function reduce(original, action, actor) {
    const t = structuredClone(original);
    let message = "";
    const type = action.type;
    const reject = (m) => ({ state: original, ok: false, message: m });
    const isTerminal = ended.has(t.status);
    const event = (m) => {
      message = m;
      t.events.push(m);
      t.updated = "刚刚";
    };
    const version = () => {
      t.commitIndex++;
      t.head = "demo-" + String(t.commitIndex).padStart(4, "0");
      t.verified = false;
      t.verification = "pending";
      t.verificationCommit = null;
      t.humanReview = null;
      t.comments.forEach((c) => {
        c.stale = c.commit !== t.head;
      });
      t.pending.forEach((p) => {
        p.stale = p.commit !== t.head;
      });
    };
    const stop = (reason) => {
      t.control = "stopping";
      t.stopReason = reason;
      t.stopUnconfirmed = false;
      t.stopConfirmed = !t.active;
      t.snapshot = t.hasChanges
        ? {
            commit: t.head,
            text: "模拟补丁：参数边界处理与回归检查；未完成验证。",
          }
        : null;
      if (!t.active) t.control = "human";
    };
    const release = () => {
      t.active = false;
      t.resource = false;
    };
    const enqueue = () => {
      t.status = "queued";
      t.phase = 0;
      t.verified = false;
      t.verification = "pending";
      t.verificationCommit = null;
    };
    const deliver = () => {
      if (t.hasChanges) {
        t.mr = t.mr || "!" + (50 + Number(t.id));
        t.mrState = "open";
        t.version++;
      }
    };
    const managerActions = [
      "start",
      "retry",
      "resume",
      "continue",
      "cancel",
      "transfer",
      "next-batch",
    ];
    if (managerActions.includes(type) && !manage(t, actor))
      return reject("仅任务负责人或项目管理员可执行此操作。");
    if (["intervene", "human-push", "merge"].includes(type) && !actor?.write)
      return reject("需要项目代码写权限。");
    if (
      ["feedback", "reconfirm-feedback", "approve"].includes(type) &&
      !review(t, actor)
    )
      return reject("仅指定审查者可提交正式要求或审查结果。");
    if (
      isTerminal &&
      ![
        "merge",
        "mr-close",
        "mr-reopen",
        "continue",
        "stop-confirm",
        "stop-timeout",
        "late-delivery",
        "config",
        "revoke",
        "comment-sync",
        "transfer",
      ].includes(type)
    )
      return reject("任务已结束；MR 事件不会自动恢复任务。");
    switch (type) {
      case "start": {
        if (t.status !== "queued" || t.control !== "agent" || t.active)
          return reject("当前不能启动自动执行。");
        if (!t.authorized) return reject("项目授权已撤销。");
        if (!t.configReady) return reject("最新项目配置需要复检。");
        if (t.pending[0]?.stale)
          return reject("待处理要求针对旧版本，请指定审查者核对后再执行。");
        const p = t.pending.shift();
        t.feedback = p?.text || t.feedback;
        t.feedbackHandled = false;
        t.currentFeedback = p || null;
        t.status = "running";
        t.phase = 2;
        t.active = true;
        t.resource = true;
        t.round++;
        t.attempt = t.round;
        t.roundConfig = t.configVersion;
        t.repairs = 0;
        t.executionMinutes = 0;
        t.stopConfirmed = false;
        t.agentJudgment = "正在分析";
        event(
          `第 ${t.round} 轮执行开始，起点 ${t.head}，配置 v${t.roundConfig}。`,
        );
        break;
      }
      case "edit":
        if (!write(t))
          return reject("Agent 写入被禁止；人工修改和终态不能被覆盖。");
        version();
        t.hasChanges = true;
        t.phase = 3;
        t.agentJudgment = "修改待验证";
        event("Agent 已产生模拟修改，当前版本 " + t.head + "。");
        break;
      case "verify-pass":
        if (!write(t) || !t.hasChanges)
          return reject("没有可验证的本轮修改，或自动操作已停止。");
        t.verified = true;
        t.verification = "passed";
        t.verificationCommit = t.head;
        t.agentJudgment = "Agent 判断验收条件已满足（模拟）";
        deliver();
        release();
        t.stopConfirmed = true;
        t.status = "review";
        t.phase = 4;
        t.feedbackHandled = Boolean(t.currentFeedback);
        event(
          `模拟检查通过，${t.version > 1 ? "更新原" : "创建"} MR ${t.mr} 第 ${t.version} 版；仍需人工审查与合入。`,
        );
        break;
      case "verify-fail":
        if (!write(t)) return reject("当前没有可执行的自动验证。");
        t.verification = "failed";
        t.verified = false;
        t.verificationCommit = t.head;
        t.agentJudgment = "验收条件未满足";
        t.repairs++;
        t.executionMinutes += 10;
        if (
          t.repairs >= t.limits.repairs ||
          t.executionMinutes >= t.limits.minutes
        ) {
          deliver();
          release();
          t.stopConfirmed = true;
          t.status = "failed";
          t.failure = "自动修复或执行时间达到上限。";
          event("已达本轮执行上限，保留草稿 MR 和失败证据，等待人工处理。");
        } else
          event(
            `模拟验证失败；已使用 ${t.repairs}/${t.limits.repairs} 次自动修复，${t.executionMinutes}/${t.limits.minutes} 分钟实际执行。`,
          );
        break;
      case "fail":
        if (t.status !== "running" || t.control !== "agent")
          return reject("当前不在自动执行中。");
        t.verified = false;
        t.verification = "failed";
        t.agentJudgment = "未完成";
        t.failure = "模拟执行环境中断";
        deliver();
        release();
        t.stopConfirmed = true;
        t.status = "failed";
        event(
          t.hasChanges
            ? "执行失败，已有修改与草稿 MR 已保留。"
            : "执行失败，无代码产物；仅保留定位与失败记录，不创建空 MR。",
        );
        break;
      case "ask":
        if (t.status !== "running" || t.control !== "agent")
          return reject("当前不能请求澄清。");
        t.question = "空分页参数应返回参数错误，还是采用项目默认值？";
        t.status = "waiting";
        t.resource = false;
        t.waitingHours = 0;
        event("等待澄清，保存代码与上下文并释放执行资源。");
        break;
      case "answer":
        if (t.status !== "waiting" || !String(action.text || "").trim())
          return reject("请填写澄清回答。");
        t.answer = action.text;
        if (t.control === "agent" && t.authorized) {
          t.status = "running";
          t.resource = true;
          event("重新获取环境，继续同一轮执行；不恢复原进程现场。");
        } else event("已保存回答；人工处理模式不会自动恢复 Agent。");
        break;
      case "remind":
        if (t.status !== "waiting") return reject("任务没有在等待澄清。");
        t.waitingHours = 24;
        t.reminded = true;
        event("已模拟等待 24 小时并提醒负责人，任务不自动取消。");
        break;
      case "feedback": {
        if (!String(action.text || "").trim())
          return reject("请填写整合后的修改要求。");
        if (action.commit !== t.head)
          return reject("代码版本已变化，请重新核对要求。");
        const p = {
          id: "batch-" + (t.events.length + 1),
          text: action.text,
          commit: t.head,
          stale: false,
          source: action.source || "平台整合",
        };
        t.pending.push(p);
        if (t.control === "agent" && !t.active && !t.conflict) {
          enqueue();
          event("正式修改要求已提交，等待下一轮执行。");
        } else
          event(
            t.control === "agent"
              ? "新增要求已入队，不改变正在执行的目标。"
              : "要求已入队；人工处理模式不会自动恢复 Agent。",
          );
        break;
      }
      case "comment-sync": {
        if (!t.mr) return reject("尚无 MR 可同步评论。");
        const n = t.comments.length;
        t.comments.push(
          ...(
            action.comments || [
              { author: "周以宁", text: "这里应返回参数错误，保持接口约定。" },
              {
                author: "陈澄",
                text: "建议使用默认参数，与上条意见需先协调。",
              },
            ]
          ).map((c, i) => ({
            ...c,
            id: "comment-" + (n + i + 1),
            file: "parameter-handler",
            line: 5,
            commit: action.commit || t.head,
            stale: (action.commit || t.head) !== t.head,
            conflict: true,
          })),
        );
        event(
          "已模拟同步 GitLab 行级评论与讨论上下文；不会自动执行，冲突由审查者整合。",
        );
        break;
      }
      case "reconfirm-feedback":
        if (!t.pending.length) return reject("没有待处理要求。");
        if (action.commit !== t.head) return reject("代码已变化，请再次核对。");
        t.pending[0].commit = t.head;
        t.pending[0].stale = false;
        event("指定审查者已核对首批要求与当前版本。");
        break;
      case "next-batch":
        if (t.active || t.control !== "agent" || !t.pending.length)
          return reject("先结束本轮执行；人工模式需显式恢复。");
        if (t.pending[0].stale) return reject("先核对旧版本要求。");
        enqueue();
        event("下一批要求已排队，执行前采用最新配置并复检。");
        break;
      case "approve":
        if (action.commit !== t.head)
          return reject("代码已变化，不能认可旧版本。");
        t.humanReview = {
          commit: t.head,
          result: "通过",
          reviewer: actor.name,
        };
        event("人工审查通过，仅记录结果；MR 合入前任务仍未完成。");
        break;
      case "intervene":
        if (t.control !== "agent") return reject("已在人工处理或停止过程中。");
        stop("human");
        event(
          t.active
            ? "已禁止自动写入，等待执行端停止；人工可处理已交出的 GitLab 分支。"
            : "已禁止自动写入，进入人工处理。",
        );
        break;
      case "stop-confirm":
        if (!t.stopReason) return reject("没有待确认的停止请求。");
        release();
        t.stopConfirmed = true;
        t.stopUnconfirmed = false;
        t.control = "human";
        if (t.cancelRequested) t.status = "canceled";
        event(
          t.cancelRequested
            ? "执行端确认停止，任务已取消。"
            : "执行端确认停止，由人工处理。",
        );
        break;
      case "stop-timeout":
        if (!t.stopReason || t.stopConfirmed)
          return reject("没有尚未确认的停止请求。");
        t.stopUnconfirmed = true;
        event(
          "已模拟 60 秒未确认停止，通知负责人及管理员；禁止恢复 Agent，自动写入仍被禁止。",
        );
        break;
      case "human-push":
        if (t.control === "agent") stop("human");
        version();
        t.hasChanges = true;
        t.agentJudgment = "人工修改后需重新判断";
        t.phase = 3;
        event(
          "已模拟人工提交 " + t.head + "；禁止自动写入，旧审查和检查结果失效。",
        );
        break;
      case "resume":
        if (t.control !== "human" || !t.stopConfirmed || t.active || t.conflict)
          return reject("需要停止确认、解除冲突后，才能恢复 Agent。");
        if (!t.authorized || !t.configReady)
          return reject("请复检最新配置与项目授权。");
        if (action.commit !== t.head)
          return reject("当前代码已变化，请重新确认恢复起点。");
        t.control = "agent";
        t.stopReason = null;
        t.stopUnconfirmed = false;
        enqueue();
        event("已显式恢复同一任务，以 " + t.head + " 为起点重新执行和验证。");
        break;
      case "retry":
        if (t.status !== "failed" || t.control !== "agent")
          return reject("人工模式需要显式恢复 Agent，重试不能夺回控制权。");
        enqueue();
        event("重新执行已排队；保留工作分支、MR 与失败记录。");
        break;
      case "transfer":
        if (!action.owner) return reject("请选择新负责人。");
        t.owner = action.owner;
        event("整个任务已转交给 " + t.owner + "；分支、MR、执行与控制权不变。");
        break;
      case "cancel":
        if (isTerminal) return reject("任务已经结束。");
        t.cancelRequested = true;
        t.status = "canceling";
        stop("cancel");
        if (t.stopConfirmed) t.status = "canceled";
        event(
          t.stopConfirmed
            ? "无活动执行，任务已取消；分支与 MR 保留。"
            : "已请求取消并禁止自动写入，等待停止确认。",
        );
        break;
      case "merge":
        if (!t.mr || t.mrState !== "open") return reject("需要已打开的 MR。");
        t.mrState = "merged";
        const wasEnded = isTerminal;
        stop("merged");
        if (!wasEnded) {
          t.status = "completed";
          t.phase = 5;
          t.completion = "MR 已合入";
        }
        event(
          wasEnded
            ? "MR 已合入，仅更新 MR 事实，保留任务结束结果。"
            : "MR 已合入，任务完成；禁止后续自动写入。",
        );
        break;
      case "mr-close":
        if (!t.mr || t.mrState === "merged")
          return reject("没有可以关闭的未合入 MR。");
        t.mrState = "closed";
        stop("closed");
        if (!isTerminal) t.status = "undelivered";
        event(
          "已模拟关闭 MR；自动写入停止，已有取消结果保留，其余任务以未交付结束。",
        );
        break;
      case "mr-reopen":
        if (t.mrState !== "closed") return reject("MR 不是已关闭状态。");
        t.mrState = "open";
        event("MR 已重新打开，任务不会自动恢复。");
        break;
      case "continue":
        if (
          !["canceled", "undelivered"].includes(t.status) ||
          t.mrState === "merged" ||
          (t.mr && t.mrState !== "open")
        )
          return reject("仅可继续未合入且 MR 已重开的取消 / 未交付任务。");
        if (action.commit !== t.head || !t.configReady)
          return reject("请重新核对当前版本并复检配置。");
        t.status = t.mr ? "review" : "failed";
        t.control = "human";
        t.cancelRequested = false;
        event("负责人选择继续任务，保留人工控制；Agent 仍需显式恢复。");
        break;
      case "conflict":
        if (isTerminal) return reject("已结束任务不能模拟合并冲突。");
        t.conflict = true;
        stop("conflict");
        event("检测到合并冲突，禁止自动修改，由人更新分支后重新验证。");
        break;
      case "resolve-conflict":
        if (!actor?.write || t.control === "agent")
          return reject("请先人工介入并取得代码写权限。");
        t.conflict = false;
        version();
        t.hasChanges = true;
        event(
          "已模拟人工解决冲突，当前版本 " + t.head + "；自动验证与审查失效。",
        );
        break;
      case "config":
        t.configVersion = action.version;
        t.configReady = Boolean(action.ready);
        event(
          "项目最新配置变为 v" +
            t.configVersion +
            "；本轮配置仍为 v" +
            t.roundConfig +
            "，新轮次需复检。",
        );
        break;
      case "revoke":
        t.authorized = false;
        stop("revoked");
        event("授权已撤销，自动写入立即被禁止，恢复前需重新授权。");
        break;
      case "late-delivery":
        event(
          "已模拟迟到交付，执行身份或控制权已失效，代码与任务结果保持不变。",
        );
        break;
      default:
        return reject("未知演示操作。");
    }
    return { state: t, ok: true, message };
  }
  return { create, reduce, names, manage, review, write, ended };
})();
export { TaskFlow };
