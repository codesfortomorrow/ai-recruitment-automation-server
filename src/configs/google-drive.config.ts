import * as fs from 'fs';
import * as path from 'path';
import { registerAs } from '@nestjs/config';

export interface GoogleDriveFolderConfig {
  rootFolderId: string;
  reactFolderId: string;
  nodeFolderId: string;
  hrFolderId: string;
  devoppsFolderId: string;
}

export interface GoogleDriveConfig extends GoogleDriveFolderConfig {
  folderId: string; // backwards compatibility alias for rootFolderId
  folderName: string;
  keyFile: string;
  pollingEnabled: boolean;
  pollingIntervalSeconds: number;
  roleFolders?: Record<string, string>;
}

export const googleDriveConfigFactory = registerAs(
  'googleDrive',
  (): GoogleDriveConfig => {
    let keyFile =
      process.env.GOOGLE_DRIVE_KEY_FILE?.trim() ||
      process.env.GOOGLE_SHEETS_KEY_FILE?.trim();

    if (!keyFile) {
      const defaultPath = './config/google-service-account.json';
      if (fs.existsSync(path.resolve(process.cwd(), defaultPath))) {
        keyFile = defaultPath;
      } else {
        const configDir = path.resolve(process.cwd(), 'config');
        if (fs.existsSync(configDir)) {
          const files = fs
            .readdirSync(configDir)
            .filter((f) => f.endsWith('.json') && !f.endsWith('.example.json'));
          if (files.length > 0) {
            keyFile = `./config/${files[0]}`;
          }
        }
      }
    }

    const rootFolderId =
      process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ||
      process.env.GOOGLE_DRIVE_CV_FOLDER_ID?.trim() ||
      '';
    const reactFolderId =
      process.env.GOOGLE_DRIVE_REACT_FOLDER_ID?.trim() || '';
    const nodeFolderId = process.env.GOOGLE_DRIVE_NODE_FOLDER_ID?.trim() || '';
    const hrFolderId = process.env.GOOGLE_DRIVE_HR_FOLDER_ID?.trim() || '';
    const devoppsFolderId =
      process.env.GOOGLE_DRIVE_DEVOPPS_FOLDER_ID?.trim() ||
      process.env.GOOGLE_DRIVE_DEVOPS_FOLDER_ID?.trim() ||
      '';

    let roleFolders: Record<string, string> | undefined;
    if (process.env.GOOGLE_DRIVE_ROLE_FOLDERS_JSON) {
      try {
        roleFolders = JSON.parse(process.env.GOOGLE_DRIVE_ROLE_FOLDERS_JSON);
      } catch {}
    }

    return {
      rootFolderId,
      reactFolderId,
      nodeFolderId,
      hrFolderId,
      devoppsFolderId,
      folderId: rootFolderId,
      folderName:
        process.env.GOOGLE_DRIVE_CV_FOLDER_NAME?.trim() ||
        'Central Repository of Resume',
      keyFile: keyFile || './config/google-service-account.json',
      pollingEnabled: process.env.GOOGLE_DRIVE_POLLING_ENABLED === 'true',
      pollingIntervalSeconds:
        parseInt(
          process.env.GOOGLE_DRIVE_POLLING_INTERVAL_SECONDS || '60',
          10,
        ) || 60,
      roleFolders,
    };
  },
);
