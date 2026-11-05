// One tiny request to check that a saved key works.
export async function askCoachTest(): Promise<{ ok: boolean; text: string }> {
  try {
    await window.desktop!.coach.ask({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'Test' }] });
    return { ok: true, text: 'The key works. You will now see "Ask the coach" on moves and puzzles.' };
  } catch (e) {
    return { ok: false, text: `The key was saved, but the test failed: ${(e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}` };
  }
}
