// Worker implementation
self.onmessage = async (event) => {
    const { taskId, messages, userApiKey, model, API_URL } = event.data;
    // Simple validation
    if (!userApiKey) {
        self.postMessage({ taskId, isComplete: true, result: '请先配置 API Key' });
        return;
    }
    const requestData = {
        model,
        messages,
        stream: true,
    };
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': \`Bearer \${userApiKey}\`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        if (response.status === 401) {
            self.postMessage({ taskId, isComplete: true, result: '认证失败，请检查 API Key 是否正确' });
            return;
        } else if (!response.ok) {
            const errText = await response.text();
            console.error('API Error:', errText);
            self.postMessage({ taskId, isComplete: true, result: \`请求失败 (\${response.status}): API 服务异常，请检查 API URL 和模型名称是否正确\` });
            return;
        }
        if (!response.body) {
            self.postMessage({ taskId, isComplete: true, result: '服务器未返回流数据' });
            return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let currentText = '';
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\\n');
            
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || trimmedLine === '') continue;
                
                if (trimmedLine.startsWith('data: ')) {
                    const jsonLine = trimmedLine.slice(6).trim();
                    if (jsonLine === '[DONE]') {
                        self.postMessage({ taskId, isComplete: true, result: currentText });
                        return;
                    }
                    try {
                        const parsedLine = JSON.parse(jsonLine);
                        // Support both OpenAI and NVIDIA format
                        const deltaContent = parsedLine?.choices?.[0]?.delta?.content || 
                                           parsedLine?.choices?.[0]?.message?.content;
                        if (deltaContent) {
                            currentText += deltaContent;
                            self.postMessage({ taskId, isComplete: false, result: currentText });
                        }
                    } catch (err) {
                        console.warn('Parse error for line:', jsonLine, err);
                        // Ignore parse errors for partial chunks
                    }
                }
            }
        }
        
        // Send final result if stream ended without [DONE]
        if (currentText) {
            self.postMessage({ taskId, isComplete: true, result: currentText });
        }
    } catch (error) {
        self.postMessage({ taskId, isComplete: true, result: \`请求出错: \${error.message}\` });
    }
};
