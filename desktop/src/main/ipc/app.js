export function registerAppIpc({ ipcMain, app, getUserFileRoot, getProjectsRoot, getCasesRoot, getStudyRoot, readState }) {
  if (!ipcMain) throw new Error('registerAppIpc: ipcMain is required');
  ipcMain.handle('app/ping', async () => {
    return {
      ok: true,
      now: new Date().toISOString(),
      version: app.getVersion(),
      userDataPath: app.getPath('userData'),
      userFileRoot: getUserFileRoot(),
      projectsRoot: getProjectsRoot(),
      casesRoot: getCasesRoot(),
      studyRoot: getStudyRoot(),
      currentProject: readState().currentProject ?? null,
      currentCase: readState().currentCase ?? null,
    };
  });
}


