import { inferVision, PROVIDER, catalogEntry } from './catalog.js';
import { orderCandidates } from './strategy.js';
import { resolveKeyId } from './identity.js';
import { chooseBalanced, describeTraits, rankForTask } from './pool.js';
import { priceOf } from './strategy.js';
const CODE_PATTERN = /```|<!doctype\s+html|<(?:script|style|html|body|div|span|template|section|article|table|form|input|button)[ >]|\b(?:def|class|function|const|let|var|import|export|return|if|for|while|switch|catch)\b|\b(?:typescript|javascript|python|java|golang|rust|c\+\+|sql)\b|代码|编程|实现(?:一个|一下)?(?:函数|接口|类|算法|缓存|组件|模块|脚本|程序)|泛型|单测|单元测试|数据结构|重构|迁移方案|并发|死锁|内存泄漏|[{};()]\s*$/i;
const TRANSLATION_PATTERN = /翻译|译成|translate|translation|英译中|中译英|本地化|localize/i;
const WRITING_PATTERN = /写作|写一篇|写一段|写个|写点|润色|改写|扩写|续写|文案|标题|摘要|总结|周报|月报|日报|模板|公文|演讲稿|开场白|致辞|发言稿|讲话稿|祝词|贺词|感谢信|道歉信|邀请函|宣传稿|新闻稿|通稿|通知|邮件|口号|标语|取名|起名|write (?:a|an)|rewrite|polish|copywrit|blog|essay|故事|小说|诗/i;
const REASONING_PATTERN = /推理|证明|推导|数学|逻辑|复杂度|渐进|分析(?:一下)?原因|为什么|求解|方程|哪个(?:更)?(?:大|小|快|慢|重|轻)|\d+(?:\.\d+)?\s*(?:和|与|vs\.?|比)\s*\d+(?:\.\d+)?|reason|prove|derive|complexity|math|logic|puzzle|step by step/i;
/** Hidden title/summary helpers use a tiny completion and never need a paid routing call. */
const UTILITY_TITLE = /(?:起|生成|写|拟|取|建议).{0,8}(?:标题|title)|(?:标题|title).{0,8}(?:生成|建议|命名)/i;
const TINY_COMPLETION_TOKENS = 128;
/** Specialty endpoints that are cheap but wrong for chat/title routing. */
const NON_CHAT_UTILITY = /(?:doc|ocr|tts|audio|asr|embedding|rerank|video|image)/i;
/** Specialists that technically accept text but are wrong for open general chat. */
const GENERAL_SPECIALIST = /(?:^|[-/])(?:mt|coder|code)(?:[-/]|$)|translat/i;
/**
 * Whether a pool id actually serves this task for the simple-chat shortcut.
 * Pinned taskRoutes entries are user intent and always count. Unpinned models
 * need the matching task tag; a high-quality general model may also cover a
 * non-general task, but a translation specialist may not cover general chat.
 */
export function taskEligible(id, task, pool, pinned) {
    if (pinned.has(id))
        return true;
    if (task === 'general' && GENERAL_SPECIALIST.test(id))
        return false;
    const traits = pool.byId.get(id)?.traits;
    if (traits === undefined)
        return false;
    if (traits.tasks.includes(task))
        return true;
    return task !== 'general' && traits.tasks.includes('general') && traits.quality >= 60;
}
/** Legacy Qwen ids that the compatible-mode endpoint often rejects with AUTH. */
const LEGACY_ROTATION_ID = /^(?:qwen-(?:7b|14b|72b|1\.8b|1\.8b-longcontext)|qwen1\.5-|qwen2(?:\.5)?-|qwen-(?:max|plus|turbo|flash)-\d|qwen-(?:flash|plus)-character|qwen-max-longcontext)/i;
/**
 * Native Bailian families that share this account's credential and the
 * compatible-mode surface. Third-party prefixes (cmaas-, antdigital/, vanchin/)
 * can look like ordinary chat models in /models yet reject the same key with
 * INVALID_REQUEST or AUTH; rotating into them breaks a whole turn.
 */
const NATIVE_ROTATION_ID = /^(?:qwen3(?:\.|\-)|qwen-(?:flash|plus|turbo|long|max)$|deepseek-v4|glm-5|kimi-k3)/i;
/**
 * Keep free-quota rotation on current, callable aliases. Dated snapshots and
 * legacy generations (qwen-turbo-2024-11-01, qwen1.5-7b-chat) either 401 on the
 * compatible endpoint or behave far below the quality bar; spending a whole
 * request on them makes rotation look broken. Pinned routes stay exempt.
 */
export function rotationEligible(id, traits, pinned = false) {
    if (pinned)
        return true;
    if (traits.snapshot)
        return false;
    const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
    // This bare alias 401s on the MaaS compatible endpoint while the dated
    // -1017 sibling shares the same account credential and works.
    if (bare.toLowerCase() === 'deepseek-v4.1-flash')
        return false;
    if (!NATIVE_ROTATION_ID.test(bare))
        return false;
    if (LEGACY_ROTATION_ID.test(bare))
        return false;
    if (traits.family === 'qwen' && traits.version > 0 && traits.version < 3
        && !/^qwen-(?:flash|plus|turbo|long|max)$/i.test(bare))
        return false;
    return true;
}
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
/**
 * Ids that only serve one narrow skill (translation, OCR, doc conversion).
 * They accept text but are the wrong answer for an open question, so the
 * balancer skips them unless the task itself is that skill.
 */
const SPECIALIST_ONLY = /(?:^|[-/_])(?:mt|mt-bench|translate|translation|ocr|doc)(?:[-/_]|$)|(?:^|[-/])qwen-mt/i;
/**
 * Narrow arithmetic-fact detector: two numbers compared in a SHORT sentence
 * ("3.11 和 3.9 哪个大"), with no demand for proof, code, or explanation.
 * Kept deliberately tight so genuine reasoning ("请证明…的大小关系") and coding
 * ("用 Python 写函数比较版本号") are never demoted to a cheap model.
 */
const ARITHMETIC_NUMBER = /(?:\d+\.?\d*|\d+\/\d+)/g;
const ARITHMETIC_ASK = /哪个|谁|比较|比大小|大小|更大|较大|还是|>|<|vs\.?/;
const DEMANDS_WORK = /证明|推导|解释|说明|理由|分析|为什么|原理|函数|代码|实现|编程|算法|讨论|所有情况|规则|语义化|版本号|python|java|javascript|正则/i;
function isPureArithmetic(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 40)
        return false;
    if (DEMANDS_WORK.test(trimmed))
        return false;
    const numbers = trimmed.match(ARITHMETIC_NUMBER) ?? [];
    if (numbers.length < 2)
        return false;
    return ARITHMETIC_ASK.test(trimmed);
}
const DEEP_HINT = /(?:架构|设计方案|重构|性能优化|并发|分布式|证明|推导|从头|端到端|完整实现|迁移|故障排查|回滚|死锁|内存泄漏|review|refactor|architecture|benchmark|analy(?:ze|sis) )/i;
/** Extract routing signals from one assembled request. */
export function analyzeRequest(options, maxChars) {
    let hasImages = false;
    let hasUserInput = false;
    let latestUserText = '';
    for (const message of options.messages) {
        if (message.role !== 'user' && message.role !== 'tool')
            continue;
        const source = message.source?.kind;
        const texts = [];
        for (const block of message.content ?? []) {
            if (block.type === 'image')
                hasImages = true;
            else if (block.type === 'text' && message.role === 'user')
                texts.push(block.text);
        }
        // DSH injects workspace rules, runtime context, skill catalogs and a time
        // stamp as role="user" messages. Only source="user" is the human's own turn.
        // Treating those context blocks as the prompt made a one-line "hello" look
        // like a complex/code task and triggered a paid decision call on every turn.
        if (texts.length > 0 && (source === undefined || source === 'user')) {
            latestUserText = texts.join('\n');
            hasUserInput = true;
        }
    }
    const userText = latestUserText.length > maxChars ? latestUserText.slice(-maxChars) : latestUserText;
    const zhChars = userText.match(new RegExp(ZH_CHAR.source, 'g'))?.length ?? 0;
    const zhRatio = userText.length === 0 ? 0 : zhChars / userText.length;
    const sample = userText.slice(-4000);
    const codeHits = sample.match(new RegExp(CODE_PATTERN.source, 'g'))?.length ?? 0;
    const codeScore = sample.length === 0 ? 0 : codeHits / Math.max(1, sample.split('\n').length);
    const translationLikely = TRANSLATION_PATTERN.test(userText);
    const writingLikely = WRITING_PATTERN.test(userText);
    const reasoningLikely = REASONING_PATTERN.test(userText);
    // The per-line density formula scores 0 for a short one-liner such as
    // "用 JavaScript 写一个数组去重函数", so an explicit language name or a
    // "写/实现…函数|类|脚本" phrase also makes the request code.
    const cueText = userText.replace(/<\/?[a-z][^>]*>/gi, ' ');
    const strongCodeCue = /\b(?:python|javascript|typescript|java|golang|rust|c\+\+|sql|bash|shell|node|react|vue)\b/i.test(cueText)
        // "实现一个快速排序" / "写个二分查找": algorithm nouns are a code signal even
        // without the word 函数.
        || /(?:快速排序|归并排序|冒泡排序|二分查找|递归|正则表达式|正则|链表|二叉树|哈希表|动态规划|闭包|指针|排序算法)/.test(cueText)
        || /(?:写|实现|编写|重构|调试|优化)[^\n。！？]{0,10}(?:函数|方法|类|脚本|程序|接口|组件|模块)/.test(cueText);
    const arithmeticFact = isPureArithmetic(userText);
    const codeLikely = !arithmeticFact
        && (codeScore >= 0.5
            || (codeScore >= 0.25 && /\bbug|报错|错误|error|exception|stack ?trace|编译|重构|refactor|debug/i.test(userText))
            || strongCodeCue);
    const heuristicTask = hasImages
        ? 'image'
        : translationLikely
            ? 'translation'
            : codeLikely
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
    if (codeLikely)
        complexity = Math.max(complexity, 25);
    // A bare arithmetic comparison needs no thinking budget and no premium
    // model: pin it to the cheapest tier regardless of wording cues.
    if (isPureArithmetic(userText))
        complexity = Math.min(complexity, 8);
    const complexityLevel = complexity < 10
        ? 'trivial'
        : complexity < 25 ? 'simple' : complexity < 40 ? 'normal' : complexity < 75 ? 'complex' : 'deep';
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
        hasUserInput,
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
export function effortFor(analysis, policy, task) {
    if (policy !== 'auto')
        return policy;
    // Chat-shaped work (copywriting, translation, small talk, image explanation)
    // rarely benefits from a long hidden chain of thought: thinking there mostly
    // burns the output budget and can truncate the visible answer. Reserve deeper
    // thinking for code/reasoning, and for genuinely complex chat tasks.
    const chatLike = task === 'writing' || task === 'translation' || task === 'general' || task === 'image';
    switch (analysis.complexityLevel) {
        case 'trivial': return 'off';
        case 'simple': return chatLike ? 'off' : 'low';
        case 'normal': return chatLike ? 'low' : 'medium';
        case 'complex': return chatLike ? 'medium' : 'high';
        case 'deep': return chatLike ? 'high' : 'max';
    }
}
/**
 * Price ceiling (estimated ¥/1M blended) for this request.
 *
 * The router should not spend a 12¥/M flagship on "which is bigger, 9.11 or
 * 9.9" or a one-line slogan. Only a genuinely deep request unlocks the top
 * tier; ordinary code and reasoning stay in the cheap/mid band so a session
 * can keep one model and preserve the provider prefix cache.
 */
export function costCapFor(analysis) {
    if (analysis.mediaIntent === 'image' || analysis.hasImages)
        return 8;
    switch (analysis.complexityLevel) {
        case 'trivial': return 3;
        case 'simple': return analysis.heuristicTask === 'code' || analysis.heuristicTask === 'reasoning' ? 4 : 3;
        case 'normal': return 4;
        case 'complex': return 8;
        case 'deep': return 12;
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
    // Cost guard. The decision model sees only models inside this band, so it
    // cannot "freely choose" a 12¥/M flagship for a trivial request. Explicit
    // taskRoutes are user intent and stay even when above the band.
    const cap = costCapFor(analysis);
    const pinned = new Set(options.userPinnedTasks.has(task) ? options.taskRoutes[task] ?? [] : []);
    const affordable = ranked.filter(id => pinned.has(id) || priceOf(id) <= cap);
    if (affordable.length > 0)
        ranked = affordable;
    // Free-quota rotation is explicitly a "spread the free credits" mode. Keep
    // genuinely weak general models out of it, but retain a task-specialized
    // light model (e.g. qwen3-coder-flash) even when its raw quality score is low.
    if (options.sortStrategy === 'free_quota') {
        const minQuality = task === 'general' ? 45 : 50;
        const safe = ranked.filter(id => {
            if (pinned.has(id))
                return true;
            const traits = pool.byId.get(id)?.traits;
            if (traits === undefined)
                return true;
            // Rotation must follow a real task affinity, not just raw quality.
            // Otherwise a translation specialist (qwen-mt-flash) becomes the "first
            // empty bucket" for a general question and immediately fails INVALID_REQUEST.
            if (!taskEligible(id, task, pool, pinned))
                return false;
            if (!rotationEligible(id, traits, pinned.has(id)))
                return false;
            return task === 'general' ? traits.quality >= minQuality : true;
        });
        if (safe.length > 0)
            ranked = safe;
    }
    const fresh = ranked.filter(id => !store.inCooldown(id));
    const cooled = ranked.filter(id => store.inCooldown(id));
    const ordered = [...fresh, ...cooled];
    // Rotation happens across the whole ranking: the least-loaded model among the
    // near-equal head takes the lead, so both the decision shortlist and the
    // fallback chain start from it.
    // Rotation only considers models that are not cooling down; a cooled model is
    // still reachable through the fallback tail of `ordered`.
    const balanced = chooseBalanced(fresh.length > 0 ? fresh : ordered, task, pool, options, store);
    const preferred = balanced.chosen !== undefined && ordered.includes(balanced.chosen)
        ? [balanced.chosen, ...ordered.filter(id => id !== balanced.chosen)]
        : ordered;
    // Explicit ordering strategies override the legacy task-weighted rotation.
    // `auto` keeps the historical behaviour untouched.
    let final = preferred;
    if (options.sortStrategy !== 'auto') {
        const keyId = resolveKeyId({ activeAccountId: options.activeAccountId, baseURL: options.baseURL, apiKeyEnv: options.apiKeyEnv });
        const ledger = store.ledgerOf(keyId, { baseURL: options.baseURL });
        const cands = final.map(id => {
            const traits = pool.byId.get(id)?.traits;
            return { id, quality: traits?.quality ?? 50, speed: traits?.speed ?? 50 };
        });
        const orderOpts = { bucketTokens: options.bucketTokens, bucketTolerance: options.bucketTolerance };
        let result = orderCandidates(cands, options.sortStrategy, ledger, orderOpts);
        if (result.allFull) {
            store.resetBucket(keyId);
            result = orderCandidates(cands, options.sortStrategy, store.ledgerOf(keyId), orderOpts);
        }
        final = result.order;
    }
    // The decision model must never see a cooling-down model: picking it wastes
    // the decision call and burns an attempt. Only when every model is cooling
    // do we show the cooled tail, so the request still has a chance.
    // A rotation turn must not hand the task to a dedicated specialist of another
    // domain (a translation endpoint answering a coding question). Only the task's
    // own specialists, generalists, and pinned models stay eligible.
    const offTask = final.filter((id) => {
        if (pinned.has(id))
            return false;
        const traits = pool.byId.get(id)?.traits;
        if (traits === undefined)
            return false;
        if (traits.tasks.includes(task))
            return false;
        return SPECIALIST_ONLY.test(id);
    });
    if (offTask.length > 0 && final.length > offTask.length) {
        final = final.filter(id => !offTask.includes(id));
    }
    const freshFinal = final.filter(id => !store.inCooldown(id));
    const decisionPool = freshFinal.length > 0 ? freshFinal : final;
    const decisionWindow = Math.max(1, Math.min(options.maxCandidatesForDecision, decisionPool.length));
    return { ranked: final, forDecision: decisionPool.slice(0, decisionWindow) };
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
        const price = `约¥${priceOf(id)}/M`;
        if (entry === undefined)
            return `- ${id}（${price}）`;
        const note = describeTraits(entry, analysis.heuristicTask);
        return note.length > 0 ? `- ${id}（${note}；${price}）` : `- ${id}（${price}）`;
    };
    const system = [
        '你是"智能路由 Auto Router"的决策模型。你的唯一任务:从给定的候选执行模型中选出最合适的一个。',
        '候选列表已经是本账号当前可用、未冷却、未超限、未连续失败的模型;不得编造或选择列表之外的 model id。',
        '选择规则:',
        '1. 含图片输入时,只能选择标注"可读图片"的模型。',
        '2. 先看任务难度与价格:简单对话、信息提取、单句写作、短翻译优先"快/便宜"的模型,不要为了用旗舰而用旗舰。',
        '3. 普通单文件代码、示例、单测优先便宜且够用的快模型;只有跨文件重构、复杂算法、线上故障排查或多轮工具链才选能力旗舰。',
        '4. 翻译任务优先"翻译专用"模型,没有专用模型时选便宜且"写作强"的通用模型。',
        '5. 中文写作/润色优先"写作强"的模型,但价格不得超过本轮预算。',
        '6. 候选已按任务匹配度、可用额度与价格带排序;同等合适时优先靠前者。',
        '7. reasoning 只写为什么选它,必须与 selected_model 一致,不要提到别的模型。',
        '只输出一个 JSON 对象,不要输出任何其他文本、解释或代码块标记,格式:',
        '{"selected_model":"<候选列表中的模型id>","reasoning":"<不超过50字的中文路由原因>"}',
    ].join('\n');
    const user = [
        `[输入模态] ${analysis.hasImages ? '图片+文本(必须选择可读图片的模型)' : '文本'}`,
        `[启发式信号] 任务猜测=${TASK_LABELS[analysis.heuristicTask]}; 代码密度=${analysis.codeScore.toFixed(2)}; 中文字符占比=${analysis.zhRatio.toFixed(2)}`,
        `[复杂度] ${analysis.complexity}/100 (${analysis.complexityLevel})`,
        `[价格预算] 约 ¥${costCapFor(analysis)}/百万 token 以内(候选已过滤)`,
        `[候选执行模型] (共 ${candidates.length} 个,均已满足可用与预算条件)`,
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
/** Chinese task labels used in user-facing route reasons. */
const TASK_CN = {
    image: '图片分析', writing: '写作', translation: '翻译', code: '代码', reasoning: '推理', general: '通用',
};
/**
 * Keep the displayed reason consistent with the model that will actually run.
 * Decision models occasionally narrate a different candidate than the id they
 * return; showing that rationale verbatim makes the panel look wrong. When the
 * text names another candidate, replace it with a deterministic, accurate
 * reason instead of preserving the contradiction.
 */
export function reconcileReason(reason, task, chosen, candidates) {
    if (reason === undefined || reason.length === 0)
        return `${TASK_CN[task]}任务；按能力、额度与候选排序选择 ${chosen}`;
    const lowered = reason.toLowerCase();
    const other = candidates.find(candidate => {
        if (candidate === chosen)
            return false;
        if (lowered.includes(candidate.toLowerCase()))
            return true;
        const name = catalogEntry(candidate)?.name;
        return name !== undefined && lowered.includes(name.toLowerCase());
    });
    if (other === undefined)
        return reason;
    return `${TASK_CN[task]}任务；按能力、额度与候选排序选择 ${chosen}`;
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
                effort: effortFor(analysis, routerOptions.thinkingEffort, 'image'),
                media: { kind: 'image', model: picked?.id ?? '', prompt: analysis.mediaPrompt ?? analysis.userText },
                reasoning: `图片生成请求 → ${picked?.id ?? '(no image model)'}`,
            };
        }
    }
    // Hidden title/summary helpers run with a tiny completion budget; paying a
    // decision model for an 8-token title would cost more than the title itself.
    const utilityCall = !analysis.hasImages && analysis.codeScore < 0.25
        && ((options.maxTokens !== undefined && options.maxTokens > 0 && options.maxTokens <= TINY_COMPLETION_TOKENS)
            || UTILITY_TITLE.test(analysis.userText));
    const simpleChat = utilityCall
        || analysis.complexityLevel === 'trivial'
        || ((heuristicTask === 'writing' || heuristicTask === 'translation' || heuristicTask === 'general')
            && analysis.complexityLevel === 'simple');
    if (simpleChat) {
        // A simple request should not burn flagship money: keep the task ranking,
        // but drop models above the request's own price band from the lead. The
        // lead must also be a model that actually serves this task: a translation
        // specialist (qwen-mt-*) must never answer a general "1+1", because the
        // endpoint rejects ordinary chat and the request then wastes four attempts.
        const cap = costCapFor(analysis);
        const pinned = new Set(routerOptions.userPinnedTasks.has(heuristicTask) ? routerOptions.taskRoutes[heuristicTask] ?? [] : []);
        const affordable = heuristic.ranked.filter(id => priceOf(id) <= cap && !NON_CHAT_UTILITY.test(id));
        const chosen = affordable.find(id => taskEligible(id, heuristicTask, pool, pinned))
            ?? affordable[0] ?? heuristic.ranked[0] ?? routerOptions.fallbackModel;
        const candidates = [
            chosen,
            ...heuristic.ranked.filter(id => id !== chosen),
        ];
        return {
            candidates,
            chosen,
            task: heuristicTask,
            heuristicTask,
            decisionSource: 'heuristic',
            effort: effortFor(analysis, routerOptions.thinkingEffort, heuristicTask),
            reasoning: utilityCall
                ? '标题/短工具请求:直选性价比模型,省去决策模型调用'
                : '简单对话/写作:按任务规则直选性价比模型,省去决策模型调用',
            ...(utilityCall ? { utility: true } : {}),
        };
    }
    if (!routerOptions.enableDecision || heuristic.forDecision.length === 0) {
        return { ...heuristicChoice(), effort: effortFor(analysis, routerOptions.thinkingEffort, heuristicTask) };
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
            // The decision model picks the model; it does not get to rewrite the
            // task classification. A math comparison called "code" in a model reply
            // used to trigger flagship routing even though the heuristic was correct.
            const task = heuristicTask;
            // Re-rank: the chosen model first; the rest keeps the heuristic order so
            // the fallback chain still prefers task-fitting models.
            const candidates = [selected, ...heuristic.ranked.filter(id => id !== selected)];
            return {
                candidates,
                chosen: selected,
                task,
                heuristicTask,
                decisionSource: 'model',
                effort: effortFor(analysis, routerOptions.thinkingEffort, task),
                decisionTokens,
                reasoning: reconcileReason(answer?.reasoning, task, selected, candidates),
            };
        }
        // Decision answer unusable (bad JSON / id outside the shortlist): heuristic.
        return {
            ...heuristicChoice(),
            effort: effortFor(analysis, routerOptions.thinkingEffort, heuristicTask),
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
            effort: effortFor(analysis, routerOptions.thinkingEffort, heuristicTask),
            reasoning: `决策模型不可用(${String(error?.message ?? error).slice(0, 120)}),使用回退模型 ${chosen}`,
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
