import { inferVision, PROVIDER } from './catalog.js';
import { chooseBalanced, describeTraits, rankForTask } from './pool.js';
const CODE_PATTERN = /```|<\/?[a-z]+[ >]|\b(?:def|class|function|const|let|var|import|export|return|if|for|while|switch|catch)\b|[{};()]\s*$/;
const TRANSLATION_PATTERN = /翻译|译成|translate|translation|英译中|中译英|本地化|localize/i;
const WRITING_PATTERN = /写作|写一篇|润色|改写|扩写|续写|文案|标题|摘要|总结|write (?:a|an)|rewrite|polish|copywrit|blog|essay|故事|小说|诗/i;
const REASONING_PATTERN = /推理|证明|推导|数学|逻辑|复杂度|渐进|分析(?:一下)?原因|为什么|求解|方程|reason|prove|derive|complexity|math|logic|puzzle|step by step/i;
const ZH_CHAR = /[\u4e00-\u9fff]/;
/** Explicit "make me a picture" intent, but not "describe this image". */
const IMAGE_INTENT = /(?:画一张|画一幅|画个|生成(?:一张|一幅|一个)?图片|生成(?:一张)?图|做一张图|配图|出图|画图|draw (?:me )?(?:a|an)? ?\w+|generate (?:an? )?image|create (?:an? )?image|make (?:an? )?(?:picture|image))/i;
const VIDEO_INTENT = /(?:生成|做|制作|拍|剪|输出|合成)[^\n]{0,12}(?:视频|短片|小片|动画|影片|movie|video|clip)|(?:视频|短片|动画)[^\n]{0,10}(?:生成|制作|合成)|(?:make|create|generate|render)[^\n]{0,20}(?:video|movie|clip)/i;
/**
 * Nouns that mean the user wants a *document or asset about* video (a script,
 * a prompt, a storyboard, a cover) or wants to *edit* an existing clip - not a
 * video to be generated. Hitting one of these downgrades the request to chat,
 * because a wrong short-circuit answers a question the user never asked.
 */
const VIDEO_EXCLUDE = /脚本|文案|分镜|提示词|大纲|封面|海报|缩略图|首帧|演示|PPT|编码|格式|剪辑|script|storyboard|prompt|cover|thumbnail|poster/i;
/** "cover/poster/thumbnail for a video" is an image request, not a video one. */
const COVER_INTENT = /封面|海报|缩略图|首帧|cover|poster|thumbnail/i;
/** A cover/poster noun only counts as an image request when a generation verb accompanies it;
 *  bare questions like "封面用什么颜色" must stay in chat. */
const COVER_VERB = /画|生成|做|出图|配图|画图|绘制|设计|draw|generate|create|make|render|design/i;
const IMAGE_READING = /(?:这张图|这幅图|图里|图片里|看图|识别(?:这张|图片)|描述(?:这张|一下这张)|what(?:'s| is) in (?:this|the) (?:image|picture)|describe (?:this|the) (?:image|picture))/i;
/** Words that signal a trivial request regardless of length. */
const TRIVIAL_HINT = /^(?:你好|hi|hello|在吗|谢谢|thanks|ok|好的|嗯)[!！。.~\s]*$/i;
/** Words that signal a demanding request. */
const DEEP_HINT = /(?:架构|设计方案|重构|性能优化|并发|分布式|证明|推导|从头|端到端|完整实现|review|refactor|architecture|benchmark|analy(?:ze|sis) )/i;
/** Extract routing signals from one assembled request. */
export function analyzeRequest(options, maxChars) {
    let hasImages = false;
    const userTexts = [];
    for (const message of options.messages) {
        if (message.role !== 'user' && message.role !== 'tool')
            continue;
        for (const block of message.content ?? []) {
            if (block.type === 'image')
                hasImages = true;
            else if (block.type === 'text' && message.role === 'user')
                userTexts.push(block.text);
        }
    }
    // The most recent user input weighs most; keep the tail within the budget.
    const joined = userTexts.slice(-6).join('\n');
    const userText = joined.length > maxChars ? joined.slice(-maxChars) : joined;
    const zhChars = userText.match(new RegExp(ZH_CHAR.source, 'g'))?.length ?? 0;
    const zhRatio = userText.length === 0 ? 0 : zhChars / userText.length;
    const sample = userText.slice(-4000);
    const codeHits = sample.match(new RegExp(CODE_PATTERN.source, 'g'))?.length ?? 0;
    const codeScore = sample.length === 0 ? 0 : codeHits / Math.max(1, sample.split('\n').length);
    const translationLikely = TRANSLATION_PATTERN.test(userText);
    const writingLikely = WRITING_PATTERN.test(userText);
    const reasoningLikely = REASONING_PATTERN.test(userText);
    const heuristicTask = hasImages
        ? 'image'
        : translationLikely
            ? 'translation'
            : codeScore >= 0.5 || (codeScore >= 0.25 && /\bbug|报错|错误|error|exception|stack ?trace|编译|重构|refactor|debug/i.test(userText))
                ? 'code'
                : writingLikely
                    ? 'writing'
                    : reasoningLikely
                        ? 'reasoning'
                        : 'general';
    // Complexity: length, structure, code density, demanding vocabulary and the
    // number of prior tool steps all push it up; a one-line greeting is trivial.
    const lengthScore = Math.min(35, userText.length / 40);
    const structureScore = Math.min(15, (userText.match(/\n/g)?.length ?? 0) / 2);
    const codePressure = Math.min(30, codeScore * 30);
    // Every demanding keyword present adds weight, so a prompt that stacks
    // several requirements outranks one that merely mentions a big word.
    const deepHits = userText.match(new RegExp(DEEP_HINT.source, 'gi'))?.length ?? 0;
    const deepScore = Math.min(48, deepHits * 16);
    const reasoningPressure = reasoningLikely ? 18 : 0;
    const toolSteps = Math.min(15, options.messages.filter(message => message.role === 'tool').length * 3);
    let complexity = Math.round(8 + lengthScore + structureScore + codePressure + deepScore + reasoningPressure + toolSteps);
    if (TRIVIAL_HINT.test(userText.trim()))
        complexity = 4;
    if (hasImages)
        complexity = Math.max(complexity, 35);
    complexity = Math.max(0, Math.min(100, complexity));
    const complexityLevel = complexity < 10
        ? 'trivial'
        : complexity < 25 ? 'simple' : complexity < 40 ? 'normal' : complexity < 65 ? 'complex' : 'deep';
    // Media intent: ask to produce something, without asking to read an image.
    // Video is checked first, but only when no exclusion noun is present: a
    // "video script" or a "video cover image" is a document/image request, and
    // short-circuiting it would answer a question the user never asked.
    const excluded = VIDEO_EXCLUDE.test(userText);
    const wantsVideo = VIDEO_INTENT.test(userText) && !excluded;
    const coverNoun = COVER_INTENT.test(userText);
    const wantsImage = !wantsVideo
        && (IMAGE_INTENT.test(userText) || (coverNoun && COVER_VERB.test(userText)))
        && !IMAGE_READING.test(userText) && !hasImages;
    return {
        hasImages,
        userText,
        zhRatio,
        codeScore,
        translationLikely,
        writingLikely,
        reasoningLikely,
        heuristicTask,
        complexity,
        complexityLevel,
        ...(wantsVideo
            ? { mediaIntent: 'video', mediaPrompt: userText.trim().slice(0, 2000) }
            : wantsImage
                ? { mediaIntent: 'image', mediaPrompt: userText.trim().slice(0, 2000) }
                : {}),
    };
}
/** Reasoning effort for one request under the configured policy. */
export function effortFor(analysis, policy) {
    if (policy !== 'auto')
        return policy;
    switch (analysis.complexityLevel) {
        case 'trivial': return 'off';
        case 'simple': return 'low';
        case 'normal': return 'medium';
        case 'complex': return 'high';
        case 'deep': return 'max';
    }
}
/**
 * Rank the pool for one request and split it into the decision window and the
 * fallback tail.
 *
 * Models in cooldown are kept (a cooled-down model still beats a hard failure)
 * but sorted behind the fresh ones, so a 429 does not lock a model out forever.
 */
export function buildCandidates(analysis, task, options, pool, store) {
    let ranked = rankForTask(task, pool, options, analysis.hasImages);
    if (ranked.length === 0 && analysis.hasImages && !pool.entries.some(entry => entry.traits.vision)) {
        // No vision model in the account: fall through to text models rather than
        // failing outright; the provider projects images to placeholders.
        ranked = rankForTask(task, pool, options, false);
    }
    // Configured per-model limits stop an exhausted model from being offered;
    // when every model is over its limit, fall back to the whole ranking so the
    // request still answers (the panel shows the exhaustion).
    const withinLimit = ranked.filter(id => store.withinLimit(id, options.modelLimits));
    if (withinLimit.length > 0)
        ranked = withinLimit;
    const fresh = ranked.filter(id => !store.inCooldown(id));
    const cooled = ranked.filter(id => store.inCooldown(id));
    const ordered = [...fresh, ...cooled];
    const window = Math.max(1, Math.min(options.maxCandidatesForDecision, ordered.length));
    // Rotation happens across the whole ranking: the least-loaded model among the
    // near-equal head takes the lead, so both the decision shortlist and the
    // fallback chain start from it.
    // Rotation only considers models that are not cooling down; a cooled model is
    // still reachable through the fallback tail of `ordered`.
    const balanced = chooseBalanced(fresh.length > 0 ? fresh : ordered, task, pool, options, store);
    const preferred = balanced.chosen !== undefined && ordered.includes(balanced.chosen)
        ? [balanced.chosen, ...ordered.filter(id => id !== balanced.chosen)]
        : ordered;
    return { ranked: preferred, forDecision: preferred.slice(0, window) };
}
const TASK_LABELS = {
    writing: '写作/润色',
    translation: '翻译',
    code: '代码',
    reasoning: '复杂逻辑/推理',
    image: '图片分析',
    general: '通用对话',
};
/**
 * Compose the decision prompt. The decision model sees the modality, heuristic
 * signals, a bounded excerpt of the recent user input, and the ranked candidate
 * shortlist; it must answer with one JSON object only.
 */
export function buildDecisionPrompt(analysis, candidates, pool, options) {
    const describe = (id) => {
        const entry = pool.byId.get(id);
        if (entry === undefined)
            return `- ${id}`;
        const note = describeTraits(entry, analysis.heuristicTask);
        return note.length > 0 ? `- ${id}(${note})` : `- ${id}`;
    };
    const system = [
        '你是"百炼智能路由"的决策模型。你的唯一任务:分析用户输入,从候选执行模型中选出最合适的一个。',
        '判定维度:输入模态(文本/图片/代码)与任务类型(写作、推理、翻译、代码、图片分析、通用对话)。',
        '路由规则:',
        '1. 含图片输入时,只能选择标注"可读图片"的模型。',
        '2. 中文写作/润色优先"写作强"的模型(如 glm、qwen-max/plus 系列、kimi)。',
        '3. 复杂逻辑/代码优先"代码强"或"推理强"的模型(如 deepseek-v4-pro、qwen-max、glm、kimi)。',
        '4. 翻译任务优先"翻译专用"模型,其次是旗舰通用模型。',
        '5. 简单对话/信息提取优先"快/便宜"的模型,复杂任务优先"能力旗舰"。',
        '6. 候选已按任务匹配度与冷却状态排序;同等合适时优先靠前者。',
        '只输出一个 JSON 对象,不要输出任何其他文本、解释或代码块标记,格式:',
        '{"selected_model":"<候选列表中的模型id>","task_type":"writing|translation|code|reasoning|image|general","reasoning":"<不超过50字的中文路由原因>"}',
    ].join('\n');
    const user = [
        `[输入模态] ${analysis.hasImages ? '图片+文本(必须选择可读图片的模型)' : '文本'}`,
        `[启发式信号] 任务猜测=${TASK_LABELS[analysis.heuristicTask]}; 代码密度=${analysis.codeScore.toFixed(2)}; 中文字符占比=${analysis.zhRatio.toFixed(2)}`,
        `[复杂度] ${analysis.complexity}/100 (${analysis.complexityLevel})`,
        `[候选执行模型] (按任务匹配度与可用额度排序, 共 ${candidates.length} 个)`,
        ...candidates.map(describe),
        `[决策模型] ${options.decisionModel}`,
        '[最近用户输入摘录]',
        '"""',
        analysis.userText.trim() || '(无文本内容,仅图片或空输入)',
        '"""',
        '请输出 JSON。',
    ].join('\n');
    return { system, user };
}
/** Extract the JSON object from a decision-model reply (tolerates fences/prose). */
export function parseDecision(content) {
    const cleaned = content.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start)
        return undefined;
    try {
        const raw = JSON.parse(cleaned.slice(start, end + 1));
        return {
            ...(typeof raw.selected_model === 'string' ? { selectedModel: raw.selected_model.trim() } : {}),
            ...(typeof raw.task_type === 'string' ? { taskType: raw.task_type.trim() } : {}),
            ...(typeof raw.reasoning === 'string' ? { reasoning: raw.reasoning.slice(0, 300) } : {}),
        };
    }
    catch (_invalidJson) {
        return undefined;
    }
}
/**
 * Run the complete routing decision for one request.
 *
 * Sequence: analyze → rank the account's pool for the task → decision model
 * (when enabled) → validate the answer against the shortlist → fall back on any
 * failure.
 */
export async function decideRoute(options, routerOptions, pool, store, client, signal) {
    const analysis = analyzeRequest(options, routerOptions.decisionInputMaxChars);
    const heuristicTask = analysis.heuristicTask;
    const heuristic = buildCandidates(analysis, heuristicTask, routerOptions, pool, store);
    const heuristicChoice = () => ({
        candidates: heuristic.ranked,
        chosen: heuristic.ranked[0] ?? routerOptions.fallbackModel,
        task: heuristicTask,
        heuristicTask,
        decisionSource: 'heuristic',
    });
    // Video intent: this endpoint serves no video surface the router can call.
    // Answer deterministically instead of spending a chat model on a script the
    // user did not ask for.
    if (analysis.mediaIntent === 'video' && routerOptions.enableMediaRouting) {
        const videoModels = pool.media.video;
        const notice = videoModels.length === 0
            ? [
                `本账号没有视频生成模型(共 ${pool.total} 个模型,其中视频模型 0 个),无法直接产出视频。`,
                '',
                '可选方案:',
                '1) **图像 + 合成**:我先用图像模型生成关键画面,短片合成另行安排(需要你确认后再做,不在本次动作内);',
                `2) 换一个开通了视频模型的账号(例如 wan2.7-video / kling),我再直接调用该接口;`,
                '3) 你提供素材,我只做剪辑合成。',
                '',
                '要我按方案 1 继续吗?回复「继续」即可。',
            ].join('\n')
            : [
                `本账号有 ${videoModels.length} 个视频模型(${videoModels.slice(0, 4).map(entry => entry.id).join(', ')}),`,
                '但当前插件只接入了图像生成的调用端,视频接口尚未接入,所以这次不自动调用。',
                '',
                '短片合成可另行安排(需要你确认后再做);要我继续吗?',
            ].join('\n');
        return {
            candidates: [],
            chosen: '',
            task: heuristicTask,
            heuristicTask,
            decisionSource: 'notice',
            effort: 'off',
            notice: { kind: 'video-unsupported', text: notice },
            reasoning: `视频意图未满足(视频模型 ${videoModels.length} 个)`,
        };
    }
    // Media intent: route to the surface that serves it, not to a chat model.
    if (analysis.mediaIntent === 'image' && routerOptions.enableMediaRouting) {
        const imageModels = pool.media.image;
        if (imageModels.length > 0) {
            const picked = imageModels[0];
            return {
                candidates: imageModels.map(entry => entry.id),
                chosen: picked?.id ?? routerOptions.fallbackModel,
                task: 'general',
                heuristicTask,
                decisionSource: 'media',
                effort: effortFor(analysis, routerOptions.thinkingEffort),
                media: { kind: 'image', model: picked?.id ?? '', prompt: analysis.mediaPrompt ?? analysis.userText },
                reasoning: `图片生成请求 → ${picked?.id ?? '(no image model)'}`,
            };
        }
    }
    if (!routerOptions.enableDecision || heuristic.forDecision.length === 0) {
        return { ...heuristicChoice(), effort: effortFor(analysis, routerOptions.thinkingEffort) };
    }
    const prompt = buildDecisionPrompt(analysis, heuristic.forDecision, pool, routerOptions);
    const decisionTimer = new AbortController();
    const timeout = setTimeout(() => decisionTimer.abort(), routerOptions.decisionTimeoutMs);
    timeout.unref?.();
    const combined = signal === undefined ? decisionTimer.signal : AbortSignal.any([signal, decisionTimer.signal]);
    try {
        const response = await client.chatOnce({
            model: routerOptions.decisionModel,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
            ],
            temperature: 0,
            maxTokens: 300,
        }, combined);
        if (signal?.aborted)
            throw new Error('aborted');
        const decisionTokens = (response.usage?.total_tokens ?? 0)
            || (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
        const content = response.choices?.[0]?.message?.content ?? '';
        const answer = parseDecision(typeof content === 'string' ? content : '');
        const selected = answer?.selectedModel;
        if (selected !== undefined && heuristic.forDecision.includes(selected)) {
            const task = ['writing', 'translation', 'code', 'reasoning', 'image', 'general']
                .find(value => value === answer?.taskType) ?? heuristicTask;
            // Re-rank: the chosen model first; the rest keeps the heuristic order so
            // the fallback chain still prefers task-fitting models.
            const candidates = [selected, ...heuristic.ranked.filter(id => id !== selected)];
            return {
                candidates,
                chosen: selected,
                task,
                heuristicTask,
                decisionSource: 'model',
                effort: effortFor(analysis, routerOptions.thinkingEffort),
                decisionTokens,
                ...(answer?.reasoning ? { reasoning: answer.reasoning } : {}),
            };
        }
        // Decision answer unusable (bad JSON / id outside the shortlist): heuristic.
        return {
            ...heuristicChoice(),
            effort: effortFor(analysis, routerOptions.thinkingEffort),
            decisionTokens,
            ...(answer?.reasoning ? { reasoning: `决策输出无效: ${answer.reasoning}` } : {}),
        };
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        // Decision model failed or timed out → the configured fallback model,
        // constrained to vision when the request carries images.
        const fallback = routerOptions.fallbackModel;
        const fallbackUsable = fallback !== PROVIDER
            && (!analysis.hasImages || pool.byId.get(fallback)?.traits.vision === true || inferVision(fallback));
        const chosen = fallbackUsable ? fallback : heuristic.ranked[0] ?? fallback;
        const candidates = [chosen, ...heuristic.ranked.filter(id => id !== chosen)];
        return {
            candidates,
            chosen,
            task: heuristicTask,
            heuristicTask,
            decisionSource: 'fallback',
            effort: effortFor(analysis, routerOptions.thinkingEffort),
            reasoning: `决策模型不可用(${String(error?.message ?? error).slice(0, 120)}),使用回退模型 ${chosen}`,
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
