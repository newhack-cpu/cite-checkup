// 开场动画与新手引导共用的事件名和本地标记。组件之间用 window 事件联系，不必把状态提到页面顶层。

/** 开场动画播完（或被跳过） */
export const INTRO_DONE = "cite:intro-done";
/** 请求打开新手引导（页眉“怎么用”按钮、邀请便签） */
export const TOUR_START = "cite:tour-start";
/** 引导已打开：工作区切回“参考文献体检”，引导的目标都在这一页 */
export const TOUR_OPEN = "cite:tour-open";
/** 引导最后一步：载入示例并开始体检 */
export const TRY_SAMPLE = "cite:try-sample";
/** 开始了一次体检：用户已经会用了，收起邀请便签 */
export const RUN_STARTED = "cite:run-started";

/** 本地标记：看过开场动画；引导看完或婉拒过 */
export const INTRO_FLAG = "cite-intro";
export const TOUR_FLAG = "cite-tour";

/** 读写本地标记；隐私模式等情况下存储不可用时当作没有标记，不报错 */
export function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 存不了就下次再提示，不影响使用 */
  }
}

/**
 * 放在 <head> 里、首次绘制前执行：第一次来访才播开场动画，看过的、或系统设置了“减少动画”的直接跳过。
 * 在这里决定而不是等 React 接管，是为了慢网络下也不会先闪一下页面再盖上动画。
 */
export const INTRO_SCRIPT = `try{var d=document.documentElement;if(localStorage.getItem("${INTRO_FLAG}")||matchMedia("(prefers-reduced-motion: reduce)").matches){d.dataset.intro="skip"}else{d.dataset.intro="play";localStorage.setItem("${INTRO_FLAG}","1")}}catch(e){document.documentElement.dataset.intro="skip"}`;
