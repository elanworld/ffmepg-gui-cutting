const {ipcRenderer, dialog} = require("electron");
const fs = require('fs');
const {execSync} = require("child_process");
const unzipper = require('unzipper');
const fetch = require('node-fetch');
const path = require('path');

const inputFiles = []
let commands = []
let outFile = ""
let intermediateFiles = [];

function refreshCommand(event) {
    console.log("event:", event);
    const videoFormat = document.getElementById("video-format").value;
    const audioFormat = document.getElementById("audio-format").value;
    if (inputFiles.length > 1) {
        commands = convertToTS(inputFiles.map(file => file.path), outFile);
    } else {
        let inputFilesArg = "";
        for (let i = 0; i < inputFiles.length; i++) {
            inputFilesArg += `-i "${inputFiles[i].path}" `;
        }
        commands = [`ffmpeg -y ${inputFilesArg} ${calculateTimeInterval()} ${videoFormat ? `-c:v ${videoFormat}` : ""} ${audioFormat ? `-c:a ${audioFormat}` : ""} "${outFile}"`];
    }
    // Update the command output textarea with all the commands executed
    document.getElementById("command-output").value = commands.join("\n");
    // display element
    if (inputFiles.length > 1) {
        showElement("format-time", false)
    } else {
        showElement("format-time", true)
    }
    return commands
}

function convertToTS(inputFiles, outputFile) {
    const codecHEVC = getVideoCodec(inputFiles[0]) === "hevc";
    const commands = [];
    intermediateFiles = []
    try {
        for (let i = 0; i < inputFiles.length; i++) {
            const intermediateFile = `intermediate${i + 1}.ts`;
            intermediateFiles.push(intermediateFile);
            // Construct FFmpeg command for each input file
            let ffmpegCmd = `ffmpeg -y -i "${inputFiles[i]}" -c copy -bsf:v ${codecHEVC ? 'hevc_mp4toannexb' : 'h264_mp4toannexb'} -f mpegts "${intermediateFile}"`;
            commands.push(ffmpegCmd);
        }

        const concatArgs = intermediateFiles.join('|');
        // Construct FFmpeg command to concatenate intermediate files
        const concatCmd = `ffmpeg -y -i "concat:${concatArgs}" -c copy -bsf:a aac_adtstoasc "${outputFile}"`;
        commands.push(concatCmd);
    } finally {
    }

    return commands;
}

function cleanFile() {
    // Cleanup intermediate files
    for (let i = 0; i < intermediateFiles.length; i++) {
        try {
            fs.unlinkSync(intermediateFiles[i]);
            console.log(`Deleted intermediate file: ${intermediateFiles[i]}`);
        } catch (err) {
            console.error(`Error deleting intermediate file: ${intermediateFiles[i]}`, err);
        }
    }
}

function showElement(id, isShow) {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = isShow ? "block" : "none";
    } else {
        console.error("无法找到元素 id：" + id);
    }
}


function getVideoCodec(filePath) {
    try {
        // 调用 ffprobe 命令获取视频文件的编解码器信息
        const result = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);

        // 解析命令输出并返回编解码器信息
        const codecName = result.toString().trim();
        return codecName;
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

async function saveFilePath() {
    const fileList = document.getElementById("out-file-list");
    fileList.innerHTML = "";

    const options = {
        title: "Save output file",
        defaultPath: "output.mp4",
        filters: [
            {name: "MP4", extensions: ["mp4"]},
            {name: "AVI", extensions: ["avi"]},
            {name: "MOV", extensions: ["mov"]}
        ]
    };
    ipcRenderer.invoke('show-save-dialog', options).then(result => {
        outFile = result.filePath
        const listItem = document.createElement("li");
        listItem.textContent = outFile;
        fileList.appendChild(listItem);
        refreshCommand(event)
    });
}

// 获取时间剪切命令
function calculateTimeInterval() {
    const startTime = parseFloat(document.getElementById("start-time").value);
    const endTime = parseFloat(document.getElementById("end-time").value);
    if (startTime > 0 || endTime > 0) {
        return `-ss ${startTime} -t ${endTime - startTime}`
    } else {
        return ""
    }
}

function handleFileSelect(event) {
    const files = event.target.files;
    for (let i = 0; i < files.length; i++) {
        inputFiles.push(files[i]);
    }
    const fileList = document.getElementById("file-list");
    fileList.innerHTML = "";
    for (let i = 0; i < inputFiles.length; i++) {
        const listItem = document.createElement("li");
        listItem.textContent = `${inputFiles[i].name} (${inputFiles[i].type}, ${inputFiles[i].size} bytes)`;
        fileList.appendChild(listItem);
    }
    refreshCommand(event);
}

function isFFmpegInstalled() {
    try {
        execSync('ffmpeg -version');
        console.log('FFmpeg 已安装');
        return true;
    } catch (error) {
        console.error('FFmpeg 未安装:', error);
        return false;
    }
}

function findFFmpegDir(startDir) {
    try {
        // 遍历目录下的所有文件和文件夹
        const files = fs.readdirSync(startDir);
        for (const file of files) {
            const filePath = path.join(startDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                // 如果是目录，则递归查找
                const ffmpegDir = findFFmpegDir(filePath);
                if (ffmpegDir) {
                    return ffmpegDir;
                }
            } else if (file === 'ffmpeg.exe' || file === 'ffmpeg') {
                // 如果找到了 ffmpeg.exe 或者 ffmpeg 文件，则返回当前目录
                return startDir;
            }
        }
    } catch (error) {
        console.error('遍历目录时出错:', error);
    }
}

function addToPath(envPath, dir) {
    // 将目录添加到环境变量 PATH 中
    return `${dir}${path.delimiter}${envPath}`;
}


async function downloadAndExtract(url, outputPath) {
    try {
        // 下载文件
        console.log('开始下载文件...');
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`下载文件失败: ${response.statusText}`);
        }
        const buffer = await response.buffer();

        // 保存文件到本地
        console.log('开始保存文件到本地...');
        fs.writeFileSync('ffmpeg-release-essentials.zip', buffer);

        // 解压文件
        console.log('开始解压文件...');
        fs.createReadStream('ffmpeg-release-essentials.zip')
            .pipe(unzipper.Extract({path: outputPath}))
            .on('close', () => {
                console.log('文件下载并解压成功！');
            });
    } catch (error) {
        console.error('下载并解压文件时出错:', error);
    }
}


function startCutter() {
    const commands = refreshCommand();
    console.log(commands);
    // 检查ffmpeg
    if (!isFFmpegInstalled()) {
        console.log('请下载并安装 FFmpeg');
        // 在此处添加跳转到官网下载的代码示例

        const confirmResult = window.confirm('未检测到安装的FFmpeg，是否前往官网下载解压安装到程序目录？');
        if (confirmResult) {
            // const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
            // const outputPath = './'; // 保存解压后文件的路径
            // downloadAndExtract(url, outputPath)
            //     .then(res => alert("下载完毕"))
            //     .catch(error => {
            //         alert("下载出错，请手动下载安装！")
            //         window.open('https://ffmpeg.org/download.html', '_blank');
            //     })
            window.open('https://ffmpeg.org/download.html', '_blank');
        }
        return;
    }

    // 执行命令
    const resultDiv = document.getElementById("result-message");
    for (const command of commands) {
        try {
            execSync(command);
            console.log('执行命令成功:', command);
        } catch (error) {
            console.error('执行命令失败:', command);
            resultDiv.textContent = `执行命令时发生错误: ${command}\n ${error}`;
            return;
        }
    }
    // 提示并清除缓存
    if (fs.existsSync(outFile)) {
        console.log('输出文件:', outFile);
        resultDiv.textContent = `输出文件: ${outFile}`;
    } else {
        console.log('生成输出文件:', outFile);
        resultDiv.textContent = `未生成输出文件: ${outFile}`;
    }
    cleanFile();
}

function init() {
    console.log("dialog", dialog)
    const ffmpegDir = findFFmpegDir(".");
    if (ffmpegDir) {
        console.log(`找到 FFmpeg 目录: ${ffmpegDir}`);
        // 将 FFmpeg 目录添加到环境变量 PATH 中
        process.env.PATH = addToPath(process.env.PATH, ffmpegDir);
    } else {
        console.log('未找到 FFmpeg 目录');
    }

    // 等待 DOMContentLoaded 事件触发后再执行初始化代码 不显示其他控件
    document.addEventListener("DOMContentLoaded", function () {
        showElement("format-time", false);
    });
}


init()