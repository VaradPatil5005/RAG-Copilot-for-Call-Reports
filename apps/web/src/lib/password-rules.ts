export interface PasswordStrength {
  score: number; // 0 to 4
  label: "Very Weak" | "Weak" | "Fair" | "Strong" | "Institutional";
  isValid: boolean;
  feedback: string[];
}

/**
 * Pure client/server safe institutional password strength evaluator.
 * Does not depend on any native Node.js addons.
 */
export function evaluatePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];

  if (password.length < 12) {
    feedback.push("Minimum 12 characters required");
  }
  if (!/[A-Z]/.test(password)) {
    feedback.push("At least one uppercase letter required");
  }
  if (!/[a-z]/.test(password)) {
    feedback.push("At least one lowercase letter required");
  }
  if (!/[0-9]/.test(password)) {
    feedback.push("At least one number required");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    feedback.push("At least one special character required (!@#$%^&*)");
  }

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  const labels: PasswordStrength["label"][] = [
    "Very Weak",
    "Weak",
    "Fair",
    "Strong",
    "Institutional",
  ];

  return {
    score,
    label: labels[score],
    isValid: feedback.length === 0,
    feedback,
  };
}
