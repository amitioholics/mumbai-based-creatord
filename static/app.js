// Application State
let state = {
    profiles: [],
    currentIndex: -1,
    filter: 'all',
    searchQuery: '',
    autoOpen: localStorage.getItem('autoOpenInstagram') === 'true'
};

// DOM Elements
const elements = {
    profileList: document.getElementById('profile-list'),
    progressText: document.getElementById('progress-text'),
    progressBar: document.getElementById('progress-bar'),
    searchInput: document.getElementById('search-input'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    reviewContainer: document.getElementById('review-card-container'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message'),
    toastIcon: document.getElementById('toast-icon')
};

// Format Helpers
function formatGMV(value) {
    if (value === undefined || value === null) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2
    }).format(value);
}

function formatFollowers(count) {
    if (!count) return '0';
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M';
    }
    if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
}

function formatNumber(value) {
    if (value === undefined || value === null) return '0';
    return new Intl.NumberFormat('en-IN').format(value);
}

// Fetch Profiles from Backend
async function loadProfiles(selectFirst = false) {
    try {
        const response = await fetch('/api/profiles');
        const data = await response.json();
        
        if (data.status === 'success') {
            state.profiles = data.profiles;
            updateProgress();
            renderSidebar();
            
            if (selectFirst && state.profiles.length > 0) {
                // Find first pending or first in list
                const firstPending = state.profiles.find(p => !p.reviewDecision);
                if (firstPending) {
                    selectProfile(firstPending.index);
                } else {
                    selectProfile(state.profiles[0].index);
                }
            } else if (state.currentIndex !== -1) {
                // Keep current selection
                selectProfile(state.currentIndex);
            }
        } else {
            showToast('Failed to load profiles: ' + data.message, true);
        }
    } catch (error) {
        showToast('Error connecting to backend: ' + error.message, true);
    }
}

// Calculate Progress Metrics
function updateProgress() {
    const total = state.profiles.length;
    const reviewed = state.profiles.filter(p => p.reviewDecision).length;
    
    elements.progressText.textContent = `${reviewed} / ${total}`;
    const percent = total > 0 ? (reviewed / total) * 100 : 0;
    elements.progressBar.style.width = `${percent}%`;
}

// Filter and Search Logic
function getFilteredProfiles() {
    return state.profiles.filter(profile => {
        // Filter tabs
        if (state.filter === 'pending' && profile.reviewDecision) return false;
        if (state.filter === 'approved' && profile.reviewDecision !== 'Yes') return false;
        if (state.filter === 'rejected' && profile.reviewDecision !== 'No') return false;
        
        // Search query
        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            const username = profile.igUserName.toLowerCase();
            const email = profile.email.toLowerCase();
            const categories = profile.contentCategories.toLowerCase();
            return username.includes(query) || email.includes(query) || categories.includes(query);
        }
        
        return true;
    });
}

// Render Sidebar List
function renderSidebar() {
    const filtered = getFilteredProfiles();
    
    if (filtered.length === 0) {
        elements.profileList.innerHTML = `
            <div class="no-results-state">
                <i class="fa-solid fa-folder-open"></i>
                <p>No profiles match filters</p>
            </div>
        `;
        return;
    }
    
    elements.profileList.innerHTML = filtered.map(profile => {
        const isActive = profile.index === state.currentIndex ? 'active' : '';
        const statusClass = profile.reviewDecision === 'Yes' ? 'approved' : 
                            profile.reviewDecision === 'No' ? 'rejected' : 'pending';
        
        return `
            <li class="profile-item ${isActive}" onclick="selectProfile(${profile.index})">
                <div class="profile-item-left">
                    <span class="profile-username" title="${profile.igUserName || 'Unnamed Profile'}">
                        @${profile.igUserName || 'unknown'}
                    </span>
                    <span class="profile-followers">
                        ${formatFollowers(profile.igFollowersCount)} followers
                    </span>
                </div>
                <div class="profile-item-right">
                    <span class="profile-gmv-badge">${formatGMV(profile.overallGmv)}</span>
                    <div class="status-indicator ${statusClass}"></div>
                </div>
            </li>
        `;
    }).join('');
}

// Select a Profile and Display in workspace
function selectProfile(index) {
    state.currentIndex = index;
    
    // Update active state in sidebar list
    const items = elements.profileList.querySelectorAll('.profile-item');
    const filtered = getFilteredProfiles();
    
    renderSidebar(); // re-render sidebar to highlight active
    
    const profile = state.profiles.find(p => p.index === index);
    if (!profile) return;
    
    // Render detail card
    renderDetailCard(profile);
    
    // If auto-open is enabled, trigger profile open in the backend
    if (state.autoOpen && profile.instagramLink && profile.instagramLink !== '0') {
        openInstagramLink(profile.instagramLink);
    }
}

// Open Instagram in user browser (Backend Helper)
async function openInstagramLink(url) {
    try {
        const response = await fetch('/api/open-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        const data = await response.json();
        if (data.status !== 'success') {
            showToast(data.message, true);
        }
    } catch (e) {
        // Fallback to client window open if server fails
        window.open(url, '_blank');
    }
}

// Render active profile card detail
function renderDetailCard(profile) {
    elements.reviewContainer.classList.remove('empty-state');
    
    const isApproveActive = profile.reviewDecision === 'Yes' ? 'active' : '';
    const isRejectActive = profile.reviewDecision === 'No' ? 'active' : '';
    
    let genderClass = 'gender-other';
    if (profile.gender.toLowerCase() === 'male') genderClass = 'gender-male';
    else if (profile.gender.toLowerCase() === 'female') genderClass = 'gender-female';

    elements.reviewContainer.innerHTML = `
        <div class="active-card">
            <!-- Header Section -->
            <div class="card-profile-header">
                <div class="user-identity">
                    <div class="user-username">
                        @${profile.igUserName || 'unknown'}
                        <span class="user-gender-tag ${genderClass}">${profile.gender || 'Unknown'}</span>
                    </div>
                    <div class="user-meta-top">
                        <span><i class="fa-solid fa-envelope"></i> ${profile.email || 'No email'}</span>
                        ${profile.phone ? `<span><i class="fa-solid fa-phone"></i> ${profile.phone}</span>` : ''}
                    </div>
                </div>
                
                <!-- Auto-Open settings toggle -->
                <label class="auto-open-wrapper">
                    <input type="checkbox" id="auto-open-checkbox" ${state.autoOpen ? 'checked' : ''} onchange="toggleAutoOpen(this.checked)">
                    <span>Auto-open Instagram</span>
                </label>
            </div>
            
            <!-- Key Stats -->
            <div class="stats-grid">
                <div class="stat-card stat-card-gmv">
                    <div class="stat-icon">
                        <i class="fa-solid fa-wallet"></i>
                    </div>
                    <div class="stat-details">
                        <span class="stat-label">Driven GMV</span>
                        <span class="stat-value">${formatGMV(profile.overallGmv)}</span>
                    </div>
                </div>
                <div class="stat-card stat-card-followers">
                    <div class="stat-icon">
                        <i class="fa-solid fa-users"></i>
                    </div>
                    <div class="stat-details">
                        <span class="stat-label">Followers Count</span>
                        <span class="stat-value">${formatNumber(profile.igFollowersCount)}</span>
                    </div>
                </div>
            </div>
            
            <!-- Detail table metadata -->
            <div class="metadata-section">
                <div class="metadata-grid">
                    <div class="meta-item">
                        <span class="meta-label">Primary Languages</span>
                        <span class="meta-value">${profile.primaryLanguages || 'Not Specified'}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Content Categories</span>
                        <span class="meta-value">${profile.contentCategories || 'Not Specified'}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Instagram Link</span>
                        <span class="meta-value"><a href="${profile.instagramLink}" target="_blank">${profile.instagramLink} <i class="fa-solid fa-up-right-from-square"></i></a></span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">YouTube Stats</span>
                        <span class="meta-value">
                            ${profile.youtubeLink && profile.youtubeLink !== '0' && profile.youtubeLink.toLowerCase() !== 'nan'
                                ? `<a href="${profile.youtubeLink}" target="_blank">Channel <i class="fa-solid fa-up-right-from-square"></i></a> (${formatFollowers(profile.ytSubscribersCount)} subs)`
                                : 'No YouTube Link'
                            }
                        </span>
                    </div>
                </div>
            </div>

            <!-- Open Profile Primary Action Button -->
            <div class="open-link-section">
                <button type="button" class="btn-open-instagram" onclick="openInstagramLink('${profile.instagramLink}')">
                    <i class="fa-brands fa-instagram"></i> Open Instagram Profile in Browser <kbd style="margin-left:auto;background:rgba(0,0,0,0.2)">O</kbd>
                </button>
            </div>
            
            <!-- Decision form -->
            <div class="review-form-section">
                <h3 class="section-title"><i class="fa-solid fa-square-check"></i> Evaluate Profile</h3>
                
                <div class="decision-buttons">
                    <button type="button" class="btn-decision approve ${isApproveActive}" onclick="handleDecision('Yes')">
                        <i class="fa-solid fa-circle-check"></i> YES / APPROVE <kbd>Y</kbd>
                    </button>
                    <button type="button" class="btn-decision reject ${isRejectActive}" onclick="handleDecision('No')">
                        <i class="fa-solid fa-circle-xmark"></i> NO / REJECT <kbd>N</kbd>
                    </button>
                </div>
                
                <div class="remarks-wrapper">
                    <label for="remarks-input">Remarks / Notes</label>
                    <textarea id="remarks-input" placeholder="Type evaluation remarks here... (Required if Rejected/NO)" oninput="updateRemarks(this.value)">${profile.reviewRemarks || ''}</textarea>
                </div>
                
                <div class="form-actions">
                    <div class="nav-buttons">
                        <button type="button" class="btn-nav" onclick="navigateProfile(-1)">
                            <i class="fa-solid fa-arrow-left"></i> Previous <kbd>←</kbd>
                        </button>
                        <button type="button" class="btn-nav" onclick="navigateProfile(1)">
                            Next <i class="fa-solid fa-arrow-right"></i> <kbd>→</kbd>
                        </button>
                    </div>
                    
                    <button type="button" class="btn-submit-review" onclick="saveReviewToExcel()">
                        <i class="fa-solid fa-floppy-disk"></i> Save Review
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Toggle Auto-open checkbox
function toggleAutoOpen(checked) {
    state.autoOpen = checked;
    localStorage.setItem('autoOpenInstagram', checked);
}

// Handle local decision click
function handleDecision(decision) {
    const profile = state.profiles.find(p => p.index === state.currentIndex);
    if (!profile) return;
    
    // Check if buttons exist and highlight the active one
    const approveBtn = document.querySelector('.btn-decision.approve');
    const rejectBtn = document.querySelector('.btn-decision.reject');
    
    if (decision === 'Yes') {
        approveBtn?.classList.add('active');
        rejectBtn?.classList.remove('active');
    } else {
        approveBtn?.classList.remove('active');
        rejectBtn?.classList.add('active');
    }
    
    profile.reviewDecision = decision;
    
    // Auto-save and advance
    saveReviewToExcel(true);
}

// Update remarks in state
function updateRemarks(value) {
    const profile = state.profiles.find(p => p.index === state.currentIndex);
    if (profile) {
        profile.reviewRemarks = value;
    }
}

// Save Review back to server
async function saveReviewToExcel(autoAdvance = false) {
    const profile = state.profiles.find(p => p.index === state.currentIndex);
    if (!profile) return;
    
    const decision = profile.reviewDecision;
    const remarks = profile.reviewRemarks;
    
    if (!decision) {
        showToast('Please select a decision (Yes or No) first.', true);
        return;
    }
    
    // If decision is NO, require remarks
    if (decision === 'No' && !remarks.trim()) {
        showToast('Remarks are required when rejecting (NO).', true);
        const remarksField = document.getElementById('remarks-input');
        remarksField?.focus();
        return;
    }
    
    try {
        const response = await fetch('/api/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                index: profile.index,
                decision: decision,
                remarks: remarks
            })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showToast('Review saved for @' + profile.igUserName);
            updateProgress();
            renderSidebar();
            
            if (autoAdvance) {
                // Delay slightly for nice UX before advancing
                setTimeout(() => {
                    navigatePending();
                }, 400);
            }
        } else {
            showToast(data.message, true);
        }
    } catch (error) {
        showToast('Error saving review: ' + error.message, true);
    }
}

// Navigate to the next pending item
function navigatePending() {
    const filtered = getFilteredProfiles();
    if (filtered.length === 0) return;
    
    // Find index of current selected item in the filtered list
    const currentFilteredIdx = filtered.findIndex(p => p.index === state.currentIndex);
    
    // Search forward from current position for a pending item
    let nextPending = filtered.slice(currentFilteredIdx + 1).find(p => !p.reviewDecision);
    
    // If not found, wrap around from beginning
    if (!nextPending) {
        nextPending = filtered.slice(0, currentFilteredIdx).find(p => !p.reviewDecision);
    }
    
    if (nextPending) {
        selectProfile(nextPending.index);
    } else {
        showToast('All matching profiles have been reviewed!');
    }
}

// Navigate step-by-step (Next / Prev)
function navigateProfile(direction) {
    const filtered = getFilteredProfiles();
    if (filtered.length === 0) return;
    
    const currentFilteredIdx = filtered.findIndex(p => p.index === state.currentIndex);
    let nextFilteredIdx = currentFilteredIdx + direction;
    
    if (nextFilteredIdx >= filtered.length) nextFilteredIdx = 0; // wrap around
    if (nextFilteredIdx < 0) nextFilteredIdx = filtered.length - 1; // wrap around
    
    selectProfile(filtered[nextFilteredIdx].index);
}

// Toast notification helper
function showToast(message, isError = false) {
    elements.toastMessage.textContent = message;
    
    if (isError) {
        elements.toast.classList.add('error-toast');
        elements.toastIcon.className = 'fa-solid fa-circle-exclamation';
    } else {
        elements.toast.classList.remove('error-toast');
        elements.toastIcon.className = 'fa-solid fa-circle-check';
    }
    
    elements.toast.classList.remove('hidden');
    
    // Auto hide
    clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, 3000);
}

// Keyboard shortcuts setup
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore keyboard shortcuts if user is typing in form inputs
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') {
            return;
        }
        
        const key = e.key.toLowerCase();
        
        // Navigation Shortcuts
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateProfile(1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateProfile(-1);
        }
        
        // Review Decisions (Y / 1) and (N / 2)
        else if (key === 'y' || e.key === '1') {
            e.preventDefault();
            handleDecision('Yes');
        } else if (key === 'n' || e.key === '2') {
            e.preventDefault();
            handleDecision('No');
        }
        
        // Open Instagram (O)
        else if (key === 'o') {
            e.preventDefault();
            const profile = state.profiles.find(p => p.index === state.currentIndex);
            if (profile && profile.instagramLink) {
                openInstagramLink(profile.instagramLink);
            }
        }
    });
}

// Event Listeners
function setupEventListeners() {
    // Search input
    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderSidebar();
    });
    
    // Filter tabs
    elements.filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            elements.filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.filter = tab.dataset.filter;
            renderSidebar();
        });
    });
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupKeyboardShortcuts();
    loadProfiles(true); // Load and auto-select first
});
