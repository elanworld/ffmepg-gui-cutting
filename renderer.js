const {ipcRenderer} = require("electron");
const fs = require('fs');
const {execSync} = require("child_process");

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

function startCutter() {
    const commands = refreshCommand();
    console.log(commands);

    const resultDiv = document.getElementById("result-message");

    for (const command of commands) {
        try {
            execSync(command);
            console.log('执行命令成功:', command);
        } catch (error) {
            console.error('执行命令失败:', command);
            resultDiv.textContent = `剪切失败，执行命令时发生错误: ${command}`;
            return;
        }
    }

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
    // 等待 DOMContentLoaded 事件触发后再执行初始化代码
    document.addEventListener("DOMContentLoaded", function() {
        showElement("format-time", false);
    });
}


init()