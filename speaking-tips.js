export const SPEAKING_TIPS = Object.freeze([
  { title: "活用声音变化", body: "通过音高、音量和语速的变化突出重点，避免整段演讲保持同一种语调。" },
  { title: "在重点前停顿", body: "关键观点前停一拍，能让听众重新集中注意力，也让下一句话更有分量。" },
  { title: "开场先建立好奇心", body: "用一个问题、冲突或具体场景开场，让听众马上知道为什么值得继续听。" },
  { title: "一句话只承载一个重点", body: "长句容易稀释信息。讲完一个观点，再自然过渡到下一个观点。" },
  { title: "用具体画面替代抽象描述", body: "与其说“我很紧张”，不如描述手心出汗、忘记第一句话的那个瞬间。" },
  { title: "让目光覆盖整个房间", body: "每次完整表达一个想法时看向一个区域，再自然移动到下一个区域。" },
  { title: "手势服务于内容", body: "用手势强调大小、方向和对比；没有表达作用时，让双手自然放松。" },
  { title: "给结构设置路标", body: "使用“首先、接下来、最后”等提示，帮助听众始终知道演讲进行到哪里。" },
  { title: "即兴回答先给结论", body: "Table Topics 可以先表明观点，再讲原因和例子，最后回到结论。" },
  { title: "反馈要具体可执行", body: "评价时说明你观察到什么、产生了什么效果，以及下一次可以尝试什么。" },
  { title: "时间不足时删细节，不删主线", body: "优先保留核心观点、关键例子和结尾，其余内容可以压缩。" },
  { title: "结尾回应开场", body: "重提开场的问题或场景，再落到核心观点，让演讲形成完整闭环。" },
]);

export function createSpeakingTipCarousel(root = document) {
  let index = 0;
  let timer;
  let touchStart = null;
  let animating = false;

  function markup({ delayed = false } = {}) {
    const tip = SPEAKING_TIPS[index];
    return `<aside class="speaking-tip-card${delayed ? " is-delayed" : ""}" data-loading-tip aria-live="polite">
      <span class="speaking-tip-label">演讲小技巧</span>
      <p><strong>${tip.title}</strong>${tip.body}</p>
      <div class="speaking-tip-dots" aria-label="可左右滑动切换演讲技巧"><button type="button" data-tip-step="-1" aria-label="上一条演讲技巧"></button><span aria-hidden="true"></span><button type="button" data-tip-step="1" aria-label="下一条演讲技巧"></button></div>
    </aside>`;
  }

  function apply(offset) {
    index = (index + offset + SPEAKING_TIPS.length) % SPEAKING_TIPS.length;
    const tip = SPEAKING_TIPS[index];
    root.querySelectorAll("[data-loading-tip]").forEach((card) => {
      card.querySelector("p").innerHTML = `<strong>${tip.title}</strong>${tip.body}`;
    });
  }

  async function show(offset) {
    const card = root.querySelector(".speaking-tip-card");
    if (!card || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply(offset);
    if (animating) return;
    animating = true;
    const direction = Math.sign(offset) || 1;
    card.style.transformOrigin = direction > 0 ? "top right" : "top left";
    const outgoing = card.animate([
      { opacity: 1, transform: "rotate(-.6deg)" },
      { opacity: 0, transform: `translate(${-direction * 34}px, -14px) rotate(${-direction * 5}deg)` },
    ], { duration: 240, easing: "cubic-bezier(.55, 0, 1, .45)", fill: "forwards" });
    try {
      await outgoing.finished;
      apply(offset);
      outgoing.cancel();
      await card.animate([
        { opacity: 0, transform: `translate(${direction * 12}px, 8px) rotate(${direction * 1.8}deg)` },
        { opacity: 1, transform: "rotate(-.6deg)" },
      ], { duration: 180, easing: "cubic-bezier(.22, 1, .36, 1)" }).finished;
    } finally {
      animating = false;
      card.style.transformOrigin = "";
    }
  }

  function start() {
    clearInterval(timer);
    if (!root.querySelector("[data-loading-tip]")) return;
    timer = setInterval(() => show(1), 4000);
  }

  function stop() {
    clearInterval(timer);
  }

  function handleClick(event) {
    const button = event.target.closest("[data-tip-step]");
    if (!button) return false;
    show(Number(button.dataset.tipStep));
    start();
    return true;
  }

  function handleTouchStart(event) {
    if (!event.target.closest("[data-loading-tip]")) return false;
    touchStart = event.touches[0].clientX;
    return true;
  }

  function handleTouchEnd(event) {
    if (touchStart === null) return false;
    const delta = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 40) {
      show(delta < 0 ? 1 : -1);
      start();
    }
    touchStart = null;
    return true;
  }

  return { markup, start, stop, handleClick, handleTouchStart, handleTouchEnd };
}
