; Dotaz — Inno Setup installer script
; Compiled in CI via: iscc /DAppVersion=X.Y.Z /DAppDir=<build-output> /DOutputDir=<out> installer\dotaz.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef AppDir
  #define AppDir "..\build\stable-win-x64\Dotaz-stable"
#endif
#ifndef OutputDir
  #define OutputDir ".."
#endif

[Setup]
AppName=Dotaz
AppVersion={#AppVersion}
AppPublisher=Contember
AppPublisherURL=https://github.com/contember/dotaz
DefaultDirName={localappdata}\Dotaz
DefaultGroupName=Dotaz
UninstallDisplayIcon={app}\Resources\app.ico
OutputDir={#OutputDir}
OutputBaseFilename=dotaz-win-x64-setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
SetupIconFile=..\assets\icon.ico
WizardStyle=modern
DisableProgramGroupPage=yes
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Dotaz"; Filename: "{app}\bin\launcher.exe"; IconFilename: "{app}\Resources\app.ico"
Name: "{autodesktop}\Dotaz"; Filename: "{app}\bin\launcher.exe"; IconFilename: "{app}\Resources\app.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\bin\launcher.exe"; Description: "Launch Dotaz"; Flags: nowait postinstall skipifsilent
