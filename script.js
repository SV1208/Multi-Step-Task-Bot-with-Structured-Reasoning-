document.addEventListener("DOMContentLoaded", () => {
    const chatContainer = document.getElementById("chat-container");
    const userInput = document.getElementById("user-input");
    const sendBtn = document.getElementById("send-btn");

    userInput.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";
        if (this.value === "") this.style.height = "auto";
    });

    userInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener("click", sendMessage);

    function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        return Math.abs(hash).toString(36);
    }

 async function sendMessage() {
        const text = userInput.value.trim();
        if (!text) return;

        appendMessage(text, "user");
        userInput.value = "";
        
        const typingId = `typing-${Date.now()}`;
        showTypingIndicator(typingId, "Analyzing request...");

        try {
            const response = await fetch("http://localhost:8000/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: text, thread_id: "default_user" })
            });
            
            if (!response.body) throw new Error("No response body");
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            
            // Context variables needed across NDJSON events
            let planSteps = [];
            let currentStepIndex = 0;
            const planBubbleId = `plan-${Date.now()}`;
            
            // CRITICAL FIX: Add a buffer to stitch broken network chunks together
            let buffer = ""; 

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // Append new chunk to our buffer
                buffer += decoder.decode(value, {stream: true});
                
                // Split by newline to get complete JSON strings
                const lines = buffer.split("\n");
                
                // The last element might be an incomplete JSON string, so we keep it in the buffer for the next loop
                buffer = lines.pop(); 
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.type === "plan") {
                            document.getElementById(typingId)?.remove();
                            planSteps = data.steps;
                            renderPlanWidget(planBubbleId, planSteps);
                        } 
                        else if (data.type === "step_executed") {
                            markStepComplete(planBubbleId, data.step);
                            currentStepIndex++;
                            if (currentStepIndex < planSteps.length) {
                                markStepActive(planBubbleId, planSteps[currentStepIndex]);
                            }
                        }
                        else if (data.type === "final_answer") {
                            forceCompleteAllSteps(planBubbleId, planSteps);
                            finalizePlanWidget(planBubbleId);
                            appendMessage(data.content, "ai");
                        }
                    } catch (e) {
                        console.error("Error parsing JSON chunk:", e, line);
                    }
                }
            }
            
            // Catch any trailing data left in the buffer after the stream closes
            if (buffer.trim()) {
                 try {
                     const data = JSON.parse(buffer);
                     if (data.type === "final_answer") {
                         forceCompleteAllSteps(planBubbleId, planSteps);
                         finalizePlanWidget(planBubbleId);
                         appendMessage(data.content, "ai");
                     }
                 } catch (e) {
                     console.error("Error parsing trailing buffer:", e, buffer);
                 }
            }
            
        } catch (error) {
            document.getElementById(typingId)?.remove();
            appendMessage(`Sorry, I encountered an error: ${error.message}`, "error");
        }
    }
    // --- UI WIDGET HELPER FUNCTIONS ---

    function showTypingIndicator(id, text) {
        const msgDiv = document.createElement("div");
        msgDiv.id = id;
        msgDiv.className = "text-gray-400 text-sm mt-2 ml-4 flex items-center gap-2 animate-pulse";
        msgDiv.innerHTML = `
            <svg class="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            ${text}
        `;
        chatContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function renderPlanWidget(bubbleId, steps) {
        const msgDiv = document.createElement("div");
        msgDiv.id = bubbleId;
        msgDiv.className = "flex flex-col items-start mt-6 animate-fade-in w-full max-w-[85%]";
        
        let html = `
            <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm w-full">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="font-semibold text-gray-800 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                        </svg>
                        Execution Plan
                    </h3>
                    <span id="${bubbleId}-status" class="text-xs font-medium px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full animate-pulse">Running</span>
                </div>
                <div class="relative border-l-2 border-gray-100 ml-3 space-y-4">
        `;

        steps.forEach((step, index) => {
            const stepId = `${bubbleId}-step-${hashCode(step)}`;
            const isFirst = index === 0;
            
            html += `
                <div id="${stepId}" class="relative pl-6 transition-all duration-300 ${isFirst ? 'opacity-100' : 'opacity-50'}">
                    <div id="${stepId}-icon" class="absolute -left-[9px] top-1 bg-white">
                        ${isFirst 
                            ? `<div class="h-4 w-4 rounded-full border-2 border-blue-500 bg-white ring-4 ring-white"></div>` 
                            : `<div class="h-4 w-4 rounded-full border-2 border-gray-300 bg-white ring-4 ring-white"></div>`
                        }
                    </div>
                    <p class="text-sm font-medium ${isFirst ? 'text-gray-900' : 'text-gray-500'}">${step}</p>
                    ${isFirst ? `<p id="${stepId}-subtext" class="text-xs text-blue-500 mt-1 flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Working...</p>` : ''}
                </div>
            `;
        });

        html += `</div></div>`;
        msgDiv.innerHTML = html;
        chatContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function markStepComplete(bubbleId, stepText) {
        const stepId = `${bubbleId}-step-${hashCode(stepText)}`;
        const stepEl = document.getElementById(stepId);
        const iconEl = document.getElementById(`${stepId}-icon`);
        const subtextEl = document.getElementById(`${stepId}-subtext`);
        
        if (stepEl && iconEl) {
            stepEl.classList.remove('opacity-50');
            stepEl.classList.add('opacity-100');
            const textEl = stepEl.querySelector('p');
            if (textEl) {
                textEl.classList.remove('text-blue-900', 'text-gray-500', 'text-gray-900');
                textEl.classList.add('text-gray-800');
            }
            
            iconEl.innerHTML = `
                <div class="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center ring-4 ring-white">
                    <svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                </div>
            `;
            if (subtextEl) subtextEl.remove();
        }
    }

    function markStepActive(bubbleId, stepText) {
        const stepId = `${bubbleId}-step-${hashCode(stepText)}`;
        const stepEl = document.getElementById(stepId);
        const iconEl = document.getElementById(`${stepId}-icon`);
        
        if (stepEl && iconEl) {
            stepEl.classList.remove('opacity-50');
            stepEl.classList.add('opacity-100');
            const textEl = stepEl.querySelector('p');
            if (textEl) {
                textEl.classList.remove('text-gray-500');
                textEl.classList.add('text-gray-900');
            }
            
            iconEl.innerHTML = `<div class="h-4 w-4 rounded-full border-2 border-blue-500 bg-white ring-4 ring-white animate-pulse"></div>`;
            
            const subtext = document.createElement('p');
            subtext.id = `${stepId}-subtext`;
            subtext.className = "text-xs text-blue-500 mt-1 flex items-center gap-1";
            subtext.innerHTML = `<svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Working...`;
            stepEl.appendChild(subtext);
        }
    }

    /**
     * Iterates through ALL steps and forces them to a complete (green check) state.
     * Removes any existing 'Working...' spinners.
     * This ensures the UI is coherent with the definitive Final Answer signal.
     */
    function forceCompleteAllSteps(bubbleId, steps) {
        steps.forEach(stepText => {
            const stepId = `${bubbleId}-step-${hashCode(stepText)}`;
            const stepEl = document.getElementById(stepId);
            const subtextEl = document.getElementById(`${stepId}-subtext`);
            const iconEl = document.getElementById(`${stepId}-icon`);

            if (stepEl && iconEl) {
                // Check if already completed (contains green check bullet)
                const isComplete = iconEl.querySelector('.bg-green-500');
                if (isComplete) return; // Skip if already done

                // Mark opacity and text color for complete
                stepEl.classList.remove('opacity-50');
                stepEl.classList.add('opacity-100');
                const textEl = stepEl.querySelector('p');
                if (textEl) {
                    textEl.classList.remove('text-blue-900', 'text-gray-500', 'text-gray-900');
                    textEl.classList.add('text-gray-800');
                }

                // Add Green Check Bullet
                iconEl.innerHTML = `
                    <div class="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center ring-4 ring-white">
                        <svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                `;
                
                // CRUCIAL CLEANUP: Remove 'Working...' text and spinner
                if (subtextEl) subtextEl.remove();
            }
        });
    }

    function finalizePlanWidget(bubbleId) {
        const statusBadge = document.getElementById(`${bubbleId}-status`);
        if (statusBadge) {
            statusBadge.className = "text-xs font-medium px-2.5 py-1 bg-green-100 text-green-700 rounded-full";
            statusBadge.textContent = "Completed";
            statusBadge.classList.remove("animate-pulse");
        }
    }

    function appendMessage(text, sender) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `flex flex-col items-${sender === 'user' ? 'end' : 'start'} mt-6 animate-fade-in w-full`;
        
        const bubble = document.createElement("div");
        
        if (sender === "user") {
            bubble.className = "bg-blue-600 text-white px-5 py-3 rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed whitespace-pre-wrap shadow-sm";
            bubble.textContent = text;
        } else if (sender === "error") {
            bubble.className = "bg-red-50 text-red-600 border border-red-200 px-5 py-3 rounded-2xl rounded-tl-none max-w-[85%] leading-relaxed";
            bubble.textContent = text;
        } else {
            bubble.className = "prose prose-sm md:prose-base bg-white text-gray-800 border border-gray-200 shadow-sm px-6 py-4 rounded-2xl rounded-tl-none max-w-[95%] leading-relaxed w-full";
            
            let safeText = text.replace(/\\\[/g, '$$$$').replace(/\\\]/g, '$$$$').replace(/\\\(/g, '$').replace(/\\\)/g, '$');  
            bubble.innerHTML = marked.parse(safeText);
            
            if (window.MathJax) {
                MathJax.typesetPromise([bubble]).catch(err => console.error("MathJax error:", err.message));
            }
        }

        msgDiv.appendChild(bubble);
        chatContainer.appendChild(msgDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
    }
});