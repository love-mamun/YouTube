import "express-session";

declare module "express-session" {
  interface SessionData {
    settingsAuthed?: boolean;
  }
}
