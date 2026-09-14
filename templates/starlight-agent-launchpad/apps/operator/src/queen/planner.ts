import { COURT_SKILLS, COURT_VERSION, REPOSITORIES } from "./court";
import type { MissionInput } from "./contracts";

export function validateMissionScope(input: MissionInput, now = Date.now()): string | null {
  if (input.repositories.some((repository) => !REPOSITORIES[input.brand].includes(repository))) {
    return "repository_outside_brand_scope";
  }
  const expiresAt = Date.parse(input.expiresAt);
  if (expiresAt <= now || expiresAt > now + 31 * 86_400_000) {
    return "mission_expiry_outside_window";
  }
  return null;
}

export function planMission(input: MissionInput) {
  const tasks = [
    { id: "inspect", role: "scholar", reviewer: "keeper", dependencies: [], skillIds: ["evidence-research", "memory-provenance"], deliverable: "Source-backed current-state assessment and unresolved assumptions.", acceptance: ["Every material claim has a source reference or is marked unknown."] },
    { id: "design", role: "architect", reviewer: "sentinel", dependencies: ["inspect"], skillIds: ["architecture-design"], deliverable: "Bounded implementation decision with failure and recovery criteria.", acceptance: ["Implementation scope fits the owner's allowed repositories and acceptance criteria."] },
    { id: "build", role: input.brand === "arcanea" ? "maker" : "worker", reviewer: "sentinel", dependencies: ["design"], skillIds: input.brand === "arcanea" ? ["creative-direction", "engineering-delivery"] : ["engineering-delivery"], deliverable: input.objective, acceptance: input.acceptanceCriteria },
    { id: "review", role: "sentinel", reviewer: "queen", dependencies: ["build"], skillIds: ["independent-review"], deliverable: "Independent acceptance decision supported by inspectable artifacts and tests.", acceptance: ["Reviewer differs from the worker and records every unresolved defect."] },
    { id: "remember", role: "chronicler", reviewer: "keeper", dependencies: ["review"], skillIds: ["memory-provenance"], deliverable: "Scoped evidence and lessons with source hashes and explicit uncertainty.", acceptance: ["Draft claims remain distinct from observed facts and linked execution evidence."] },
  ];
  const selectedIds = new Set(tasks.flatMap((task) => task.skillIds));
  return {
    schemaVersion: "starlight.mission-plan.v1",
    courtVersion: COURT_VERSION,
    state: "planned",
    method: "deterministic-dependency-plan",
    authority: { ownerMandate: input.ownerMandate, delegatedDecision: "plan-and-record", mayExecute: false, mayChangePermissions: false },
    input,
    blockers: ["worker-runtime-not-dispatched", "independent-review-not-performed"],
    budget: { ceilingUsd: input.budgetUsd, authorizedSpendUsd: 0, spentUsd: 0 },
    tasks: tasks.map((task) => ({ ...task, state: "proposed", repositories: input.repositories, effectsAuthorized: false })),
    skills: COURT_SKILLS.filter((skill) => selectedIds.has(skill.id)),
    epistemicStatus: { sources: "owner-supplied-not-fetched", assumptions: input.assumptions, claimsVerified: false },
    nextAction: "An authenticated owner can authorize a compatible runtime separately through the existing operator workflow boundary.",
  };
}
