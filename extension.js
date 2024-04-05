//copyright (c) 2019 pgmjah. All rights reserved.

'use strict'

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const EventEmitter = require("events");
const fs = require("fs");
const paths = require("path");
const fsync = require("pgmjah-filesync");

class fsExtension extends EventEmitter
{
	constructor(context)
	{
		super();

		this._context = context;
		this._configFiles = {};

		//keep an eye on various events.
		this.on("fsync", this._onFileSyncLog.bind(this));
		process.on("fsync_log", this._onFileSyncLog.bind(this));
		
		vscode.workspace.onDidChangeWorkspaceFolders(this._onWorkspaceFolderChange.bind(this));
		vscode.workspace.onDidChangeConfiguration(this._onConfigChange.bind(this));

		//start the outpus channel to show progress/status
		this._outChan = vscode.window.createOutputChannel("FileSync Output");

		//add command for creating default config file.
		vscode.commands.registerCommand("filesync.createConfigFile", this._onCreateConfigFile.bind(this));
		vscode.commands.registerCommand("filesync.toggleSyncs", this.toggleFileSyncs.bind(this));
		vscode.commands.registerCommand("filesync.startAllSyncs", this.startFileSyncs.bind(this));
		vscode.commands.registerCommand("filesync.stopAllSyncs", this.stopFileSyncs.bind(this));

		//create status bar item
		this._sbItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
		this._sbItem.text = `FileSync`;

		this._fsw = vscode.workspace.createFileSystemWatcher("**/fsconfig.json", false, false, false);
		this._fsw.onDidChange(this._onFileSystemChangeCreateEvent.bind(this));
		this._fsw.onDidCreate(this._onFileSystemChangeCreateEvent.bind(this));
		this._fsw.onDidDelete(this._onFileSystemDeleteEvent.bind(this));

		//just force initial internal settings to be what's saved in the vscode config.
		this._onConfigChange();

		//get initial fsconfig.json files loaded.
		this._onWorkspaceFolderChange();
	}
	_onWorkspaceFolderChange(changeInfo)
	{
		//reload fsconfig.json files when workspace/folder changes.
		vscode.workspace.findFiles("**/fsconfig.json").then((arConfigs)=>
		{
			for(let i = 0; i < arConfigs.length; ++i)
				this._loadConfigFile(arConfigs[i].fsPath);
		});
	}
	_onConfigChange()
	{
		let config = vscode.workspace.getConfiguration("filesync");
		this._onFileSyncLog("configChange", "update", config);
		(config.showStatusBarInfo) ? this._sbItem.show() : this._sbItem.hide();
	}
	_onCreateConfigFile()
	{
		vscode.window.showWorkspaceFolderPick({"placeHolder":"Where to save fsconfig.json file"}).then(function(pathInfo)
		{
			if(!pathInfo)
				return;
			let destPath = `${pathInfo.uri.fsPath}\\fsconfig.json`;
			fsync.fileSync.createDefaultConfigFile(destPath);
		}.bind(this));
	}
	toggleFileSyncs()
	{
		var items = [];
		for(let key in this._configFiles)
		{
			let cfgFile = this._configFiles[key];
			cfgFile.configs.map((config)=>
			{
				let syncs = (config.sync instanceof Array) ? config.sync : [config.sync];
				syncs.map((sync)=>
				{
					items.push(
					{
						"label":`${config.name} - ${fsync.fileSync.fmtPath(sync.src)}`,
						"picked":sync.active,
						"sync":sync,
						"config":config
					});
				});
			});
		}

		vscode.window.showQuickPick(items,
		{
			canPickMany:true,
			ignoreFocusOut:true,
			matchOnDescription:true,
			matchOnDetail:true,
			placeHolder:"Select the FileSyncs you want to enable"
		}).then((selItems)=>
		{
			//UI cancelled
			if(!selItems)
				return;
			
			//turn on/off the syncs.
			items.map((item)=>
			{
				(selItems.indexOf(item) != -1) ? item.config.fsync.startSyncs(item.sync) : item.config.fsync.stopSyncs(item.sync);
			});
		});
	}
	_onFileSystemChangeCreateEvent(event)
	{
		console.dir(event);
		this._loadConfigFile(event.fsPath, true);
	}
	_onFileSystemDeleteEvent(event)
	{
		this.stopFileSyncs(event.path);
	}
	startFileSyncs()
	{
		this._startFileSyncs(true);
	}
	stopFileSyncs()
	{
		this._startFileSyncs(false);
	}
	_startFileSyncs(start, filePath)
	{
		for(let cfgPath in this._configFiles)
		{
			if((filePath === undefined) || (cfgPath == filePath))
			{
				var cfgFile = this._configFiles[cfgPath];
				for(let i = 0; i < cfgFile.configs.length; ++i)
				{
					let fsync = cfgFile.configs[i].fsync;
					if(fsync)
						start ? fsync.startSyncs() : fsync.stopSyncs();
				}
			}
		}
	}
	_loadConfigFile(filePath)
	{
		let uri = vscode.Uri.file(filePath);
		vscode.workspace.fs.readFile(uri).then((fileContent)=>
		{
			//kill existing filesync
			this._startFileSyncs(false, filePath);
			delete this._configFiles[filePath];

			//load the new file
			let cfgFile = this._configFiles[filePath] = this._configFiles[filePath] || fsync.fileSync.loadConfigFile(filePath, true);
			for(let cfg in cfgFile.configs)
			{
				cfgFile.configs[cfg].fsync.on("fsync_log", this._onFileSyncLog.bind(this));
			}
		});
	}
	_onFileSyncLog(type, action, data)
	{
		let logMsg = fsync.fileSync.fmtLogMessage(type, action, data);
		let dateMsg = `[${logMsg.date}] ${logMsg.msg}`;
		this._outChan.appendLine(dateMsg);
		this._sbItem.text = `$(zap) FileSync: ${logMsg.msg}`;
		console.log(dateMsg);
	}
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context)
{
	new fsExtension(context);
}

// this method is called when your extension is deactivated
function deactivate()
{
	this._fext.stopFileSyncs();
	delete this._fext;
}

module.exports = {
	"activate":activate,
	"deactivate":deactivate
}
