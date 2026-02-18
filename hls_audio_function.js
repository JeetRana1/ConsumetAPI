// Add this function after setupAudioButton() in player.html

function setupHlsAudioTrackButton() {
    if (!hls || !hls.audioTracks || hls.audioTracks.length <= 1) return;
    if (document.getElementById('custom-hls-audio-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'custom-hls-audio-btn';
    btn.className = 'plyr__control';
    btn.innerHTML = '<i class="fa-solid fa-language"></i><span class="plyr__sr-only">Audio Language</span>';
    btn.style.marginLeft = '10px';

    const controls = player.elements.controls;
    if (controls) {
        controls.appendChild(btn);
    }

    const hlsAudioMenuContainer = document.createElement('div');
    hlsAudioMenuContainer.className = 'audio-menu';
    hlsAudioMenuContainer.id = 'hls-audio-menu';

    hls.audioTracks.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = `audio-item ${index === hls.audioTrack ? 'selected' : ''}`;
        item.innerText = track.name || track.lang || `Audio ${index + 1}`;
        item.onclick = () => {
            hls.audioTrack = index;
            console.log('Switched to audio track:', track.name || track.lang);
            // Update UI
            hlsAudioMenuContainer.querySelectorAll('.audio-item').forEach((el, i) => {
                el.classList.toggle('selected', i === index);
            });
            hlsAudioMenuContainer.classList.remove('active');
        };
        hlsAudioMenuContainer.appendChild(item);
    });

    player.elements.container.appendChild(hlsAudioMenuContainer);

    btn.onclick = (e) => {
        e.stopPropagation();
        // Close other menus
        if (audioMenuContainer) audioMenuContainer.classList.remove('active');
        if (episodeMenuContainer) episodeMenuContainer.classList.remove('active');
        hlsAudioMenuContainer.classList.toggle('active');
    };

    document.addEventListener('click', (e) => {
        if (hlsAudioMenuContainer && hlsAudioMenuContainer.classList.contains('active')) {
            if (!hlsAudioMenuContainer.contains(e.target) && e.target !== btn) {
                hlsAudioMenuContainer.classList.remove('active');
            }
        }
    });
}
