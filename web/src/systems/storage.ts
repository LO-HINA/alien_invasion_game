const KEY = 'neon-starfighter.highscore';

export function loadHighScore(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(score: number): boolean {
  if (score <= loadHighScore()) return false;
  try {
    localStorage.setItem(KEY, String(score));
  } catch {
    // 无痕模式等场景下存储不可用，忽略
  }
  return true;
}
