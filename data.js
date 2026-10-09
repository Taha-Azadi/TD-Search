/**
 * data.js — Built-in demo dataset for TD Search
 * These documents are clearly labeled as DEMO and can be deleted by the user.
 */

const DEMO_DOCUMENTS = [
  {
    id: 'demo-1',
    title: 'Introduction to Python Programming',
    url: 'demo://python-intro.html',
    description: 'Learn the fundamentals of Python: variables, data types, control flow, functions, and modules. Perfect for absolute beginners.',
    headings: ['What is Python?', 'Variables and Types', 'Control Flow', 'Functions', 'Modules and Packages'],
    text: `Python is a high-level, interpreted programming language known for its clear syntax and readability. Created by Guido van Rossum and first released in 1991, Python emphasizes code readability with significant indentation. Variables in Python are dynamically typed. You can assign integers, floats, strings, lists, dictionaries, and more without declaring types. Control flow includes if-elif-else statements, for loops, and while loops. Functions are defined with the def keyword. Python has a rich standard library and a massive ecosystem of third-party packages available via pip. Popular frameworks include Django and Flask for web development, NumPy and Pandas for data science, and TensorFlow and PyTorch for machine learning.`,
    wordCount: 120,
    indexedAt: Date.now() - 86400000 * 5,
    metadata: { source: 'demo', tags: ['python', 'programming', 'beginner'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-2',
    title: 'Modern JavaScript Essentials',
    url: 'demo://javascript-essentials.html',
    description: 'A practical guide to modern JavaScript including ES6+ features, async programming, modules, and DOM manipulation.',
    headings: ['ES6 Features', 'Promises and Async/Await', 'Modules', 'DOM API', 'Event Handling'],
    text: `JavaScript is the language of the web. Modern JavaScript (ES6 and beyond) introduced let and const, arrow functions, template literals, destructuring, spread operators, classes, and modules. Asynchronous programming is handled with Promises and the async/await syntax. The Document Object Model (DOM) allows scripts to interact with HTML pages. Event listeners respond to user actions like clicks and keypresses. JavaScript runs in browsers and also on servers via Node.js. Popular libraries and frameworks include React, Vue, Angular, and Svelte for building user interfaces.`,
    wordCount: 110,
    indexedAt: Date.now() - 86400000 * 4,
    metadata: { source: 'demo', tags: ['javascript', 'es6', 'web'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-3',
    title: 'HTML5 Semantic Markup Guide',
    url: 'demo://html5-guide.html',
    description: 'Master semantic HTML5 elements for accessible, SEO-friendly web pages. Covers structure, forms, media, and accessibility.',
    headings: ['Document Structure', 'Semantic Elements', 'Forms', 'Media Elements', 'Accessibility'],
    text: `HTML5 provides semantic elements that describe the meaning of content. Use header, nav, main, article, section, aside, and footer to structure pages meaningfully. Forms support new input types like email, date, number, and range. The video and audio elements allow native media playback without plugins. Accessibility is improved with ARIA attributes and proper heading hierarchy. Always provide alt text for images. Semantic HTML improves SEO because search engines better understand page structure. Validate your markup and test with screen readers.`,
    wordCount: 95,
    indexedAt: Date.now() - 86400000 * 3,
    metadata: { source: 'demo', tags: ['html', 'html5', 'semantics', 'accessibility'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-4',
    title: 'CSS Layouts: Flexbox and Grid',
    url: 'demo://css-layouts.html',
    description: 'Deep dive into modern CSS layout techniques using Flexbox and CSS Grid for responsive, flexible designs.',
    headings: ['Flexbox Basics', 'Flex Properties', 'CSS Grid', 'Grid Areas', 'Responsive Design'],
    text: `CSS Flexbox is a one-dimensional layout model ideal for rows or columns. Key properties include display flex, flex-direction, justify-content, align-items, and flex-grow. CSS Grid is a two-dimensional system for complex page layouts. Define columns and rows with grid-template-columns and grid-template-rows. Named grid areas make complex layouts readable. Combine Flexbox and Grid for powerful responsive designs. Use media queries and container queries to adapt layouts across screen sizes. Modern CSS also includes custom properties (variables), calc, clamp, and container queries.`,
    wordCount: 105,
    indexedAt: Date.now() - 86400000 * 2,
    metadata: { source: 'demo', tags: ['css', 'flexbox', 'grid', 'layout'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-5',
    title: 'Web Development Fundamentals',
    url: 'demo://web-dev-fundamentals.html',
    description: 'Overview of the core technologies and practices that power modern web development: HTTP, browsers, tooling, and performance.',
    headings: ['How the Web Works', 'HTTP and HTTPS', 'Browser Rendering', 'Developer Tools', 'Performance Basics'],
    text: `Web development combines HTML for structure, CSS for presentation, and JavaScript for behavior. Browsers request resources over HTTP or HTTPS. The rendering engine parses HTML into a DOM tree, applies CSS, and paints pixels. Developer tools in Chrome, Firefox, and Safari help inspect elements, debug scripts, and analyze network performance. Performance optimization includes minimizing payloads, lazy loading images, using efficient selectors, and leveraging caching. Progressive enhancement and responsive design ensure sites work across devices. Version control with Git is essential for collaboration.`,
    wordCount: 115,
    indexedAt: Date.now() - 86400000 * 1,
    metadata: { source: 'demo', tags: ['web', 'development', 'http', 'performance'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-6',
    title: 'Linux Command Line Basics',
    url: 'demo://linux-cli.html',
    description: 'Essential Linux terminal commands for navigation, file management, permissions, processes, and package management.',
    headings: ['Navigation', 'File Operations', 'Permissions', 'Processes', 'Package Managers'],
    text: `The Linux command line is a powerful interface for system administration and development. Navigate directories with cd, ls, and pwd. Create, copy, move, and delete files with touch, cp, mv, and rm. Understand file permissions with chmod and chown. View running processes with ps and top, and manage them with kill. Package managers like apt, dnf, and pacman install software. Piping and redirection connect commands. Learn grep for searching, find for locating files, and ssh for remote access. Mastering the shell dramatically improves productivity on Unix-like systems.`,
    wordCount: 100,
    indexedAt: Date.now() - 86400000 * 6,
    metadata: { source: 'demo', tags: ['linux', 'cli', 'bash', 'sysadmin'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-7',
    title: 'Git Version Control Tutorial',
    url: 'demo://git-tutorial.html',
    description: 'Learn Git fundamentals: repositories, commits, branches, merging, remotes, and collaborative workflows.',
    headings: ['Repositories', 'Commits and History', 'Branches', 'Merging and Rebasing', 'Remotes and Collaboration'],
    text: `Git is a distributed version control system created by Linus Torvalds. Initialize a repository with git init. Stage changes with git add and commit with git commit. Branches allow parallel development; create them with git branch and switch with git checkout or git switch. Merge branches with git merge. Resolve conflicts carefully. Remotes like GitHub and GitLab host shared repositories. Push and pull synchronize local and remote history. Useful commands include git status, git log, git diff, and git stash. Write clear commit messages. Use pull requests for code review.`,
    wordCount: 108,
    indexedAt: Date.now() - 86400000 * 7,
    metadata: { source: 'demo', tags: ['git', 'version-control', 'collaboration'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-8',
    title: 'C++ Programming Overview',
    url: 'demo://cpp-overview.html',
    description: 'Introduction to C++ covering syntax, memory management, object-oriented programming, STL, and modern C++ features.',
    headings: ['Syntax Basics', 'Memory Management', 'Classes and OOP', 'Standard Template Library', 'Modern C++'],
    text: `C++ is a powerful general-purpose language that supports both high-level and low-level programming. It extends C with object-oriented features like classes, inheritance, and polymorphism. Manual memory management with new and delete requires care; smart pointers in modern C++ help prevent leaks. The Standard Template Library provides containers (vector, map, set), algorithms, and iterators. Modern C++ (C++11 and later) introduced auto, range-based for loops, lambda expressions, move semantics, and concurrency support. C++ is widely used in systems programming, game engines, embedded systems, and high-performance applications.`,
    wordCount: 112,
    indexedAt: Date.now() - 86400000 * 8,
    metadata: { source: 'demo', tags: ['cpp', 'c++', 'programming', 'stl'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-9',
    title: 'Go Language Crash Course',
    url: 'demo://golang-crash.html',
    description: 'Get started with Go (Golang): syntax, concurrency with goroutines, packages, interfaces, and building CLI tools.',
    headings: ['Why Go?', 'Basic Syntax', 'Goroutines and Channels', 'Packages and Modules', 'Building Tools'],
    text: `Go is an open-source language designed at Google for simplicity, reliability, and efficient concurrency. Its syntax is clean and its toolchain is fast. Goroutines are lightweight threads managed by the Go runtime. Channels enable safe communication between goroutines. Interfaces in Go are satisfied implicitly. Modules manage dependencies. The standard library is excellent for networking, encoding, and testing. Go compiles to a single static binary, making deployment simple. It is popular for cloud services, DevOps tooling, and microservices. Tools like Docker and Kubernetes are written in Go.`,
    wordCount: 105,
    indexedAt: Date.now() - 86400000 * 9,
    metadata: { source: 'demo', tags: ['go', 'golang', 'concurrency'], filetype: 'html' },
    isDemo: true
  },
  {
    id: 'demo-10',
    title: 'Building Offline-First Applications',
    url: 'demo://offline-first.html',
    description: 'Strategies for building applications that work without a network: service workers, IndexedDB, caching, and sync.',
    headings: ['Offline-First Philosophy', 'Service Workers', 'IndexedDB', 'Cache Strategies', 'Background Sync'],
    text: `Offline-first applications prioritize local data and functionality so users can work without connectivity. Service workers intercept network requests and serve cached responses. IndexedDB provides a transactional database in the browser for structured data. Cache API stores request/response pairs. Strategies include cache-first, network-first, and stale-while-revalidate. Background Sync queues actions to retry when connectivity returns. Progressive Web Apps (PWAs) combine these technologies with a web app manifest for installability. Privacy-conscious apps can keep all data local. This offline search engine is itself an example of an offline-first architecture.`,
    wordCount: 118,
    indexedAt: Date.now() - 86400000 * 0.5,
    metadata: { source: 'demo', tags: ['offline', 'pwa', 'indexeddb', 'service-worker'], filetype: 'html' },
    isDemo: true
  }
];
