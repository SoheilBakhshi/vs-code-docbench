export const addScriptSync = (path: string, id: string) => {
    if (document.getElementById(id)) {
        return false;
    }
    const xhrObj = new XMLHttpRequest();
    xhrObj.open("GET", path, false);
    xhrObj.setRequestHeader("Accept",
        "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01");
    xhrObj.send("");
    const scriptElement = document.createElement("script");
    scriptElement.type = "text/javascript";
    scriptElement.text = xhrObj.responseText;
    scriptElement.id = id;
    document.head.appendChild(scriptElement);
};

export const addScript = (path: string, id: string) => {
    return new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
            resolve(true);
            return false;
        }
        const scriptElement = document.createElement("script");
        scriptElement.src = path;
        scriptElement.async = true;
        document.head.appendChild(scriptElement);
        scriptElement.onerror = (event) => {
            reject(event);
        }
        scriptElement.onload = () => {
            if (document.getElementById(id)) {
                scriptElement.remove();
                resolve(true);
                return false;
            }
            scriptElement.id = id;
            resolve(true);
        };
    });
};
