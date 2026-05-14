import { useCallback, useEffect, useState } from "react";
import type { SkillInfo } from "../../shared/ipc-channels";
import { IPC } from "../../shared/ipc-channels";
import { ipc } from "../lib/ipc-client";

export interface SkillManagerState {
  skills: SkillInfo[];
  loading: boolean;
  error: string | null;
  expandedSkill: string | null;
  setExpandedSkill: (v: string | null) => void;
  load: () => Promise<void>;
  toggle: (name: string, enabled: boolean) => Promise<void>;
  deleteSkill: (name: string) => Promise<void>;
}

export function useSkillManager(enabled: boolean): SkillManagerState {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.invoke(IPC.GET_SKILLS);
      setSkills(result);
    } catch {
      setError("Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(async (name: string, enabled: boolean) => {
    await ipc.invoke(IPC.TOGGLE_SKILL, { name, enabled });
    setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
  }, []);

  const deleteSkill = useCallback(async (name: string) => {
    await ipc.invoke(IPC.DELETE_SKILL, { name });
    setSkills((prev) => prev.filter((s) => s.name !== name));
  }, []);

  useEffect(() => {
    if (enabled) {
      void load();
    }
  }, [enabled, load]);

  return {
    skills,
    loading,
    error,
    expandedSkill,
    setExpandedSkill,
    load,
    toggle,
    deleteSkill,
  };
}
