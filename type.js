const input = document.getElementById('movieName');
const text = "Type in a movie you've watched recently...";
let index = 0;

function typeWriter() {
  if (index < text.length) {
    input.placeholder = text.substring(0, index + 1) + "|";
    index++;
    setTimeout(typeWriter, 150);  // slower
  } else {
    input.placeholder = text;
    // Restart after 2 seconds
    setTimeout(() => {
      index = 0;
      typeWriter();
    }, 4000);
  }
}

window.onload = typeWriter;