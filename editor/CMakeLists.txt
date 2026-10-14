cmake_minimum_required(VERSION 3.21)
project(SkylandersLevelEditor VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Qt6 6.2 REQUIRED COMPONENTS Core Widgets OpenGL)

add_executable(skylanders-level-editor
    src/main.cpp src/backend.cpp src/backend.h src/window.cpp src/window.h
    src/mcp.cpp src/mcp.h src/sceneview.cpp src/sceneview.h src/gpurenderer.cpp src/gpurenderer.h src/portaldialog.cpp src/portaldialog.h)
target_link_libraries(skylanders-level-editor PRIVATE Qt6::Core Qt6::Widgets Qt6::OpenGL)
target_compile_definitions(skylanders-level-editor PRIVATE
    LEVEL_BUILDER_DEFAULT="${CMAKE_CURRENT_SOURCE_DIR}/../tools/level_builder.mjs")
if(MSVC)
    target_compile_options(skylanders-level-editor PRIVATE /W4)
else()
    target_compile_options(skylanders-level-editor PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
option(SKYLANDERS_GPU_TESTS "Run explicit desktop OpenGL tests (requires a working display/driver)" OFF)
if(BUILD_TESTING)
    find_program(NODE_EXECUTABLE node REQUIRED)
    add_test(NAME mcp_protocol COMMAND "${NODE_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/protocol.mjs"
        "$<TARGET_FILE:skylanders-level-editor>"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/mock_backend.mjs")
    add_test(NAME ui_startup COMMAND skylanders-level-editor --smoke-test)
    set_tests_properties(ui_startup PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
    add_executable(editor-gui-workflow-test tests/gui_workflow.cpp
        src/window.cpp src/backend.cpp src/sceneview.cpp src/gpurenderer.cpp src/portaldialog.cpp)
    target_include_directories(editor-gui-workflow-test PRIVATE src)
    target_link_libraries(editor-gui-workflow-test PRIVATE Qt6::Core Qt6::Widgets Qt6::OpenGL)
    add_test(NAME ui_workflow COMMAND editor-gui-workflow-test "${NODE_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/mock_backend.mjs")
    set_tests_properties(ui_workflow PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
    add_executable(editor-portal-workflow-test tests/portal_workflow.cpp src/portaldialog.cpp)
    target_include_directories(editor-portal-workflow-test PRIVATE src)
    target_link_libraries(editor-portal-workflow-test PRIVATE Qt6::Core Qt6::Widgets)
    add_test(NAME portal_ui_workflow COMMAND editor-portal-workflow-test "${NODE_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/mock_portal.mjs")
    set_tests_properties(portal_ui_workflow PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
    add_executable(editor-texture-render-test tests/texture_render.cpp src/sceneview.cpp src/gpurenderer.cpp)
    target_include_directories(editor-texture-render-test PRIVATE src)
    target_link_libraries(editor-texture-render-test PRIVATE Qt6::Core Qt6::Widgets Qt6::OpenGL)
    add_test(NAME texture_render COMMAND editor-texture-render-test)
    set_tests_properties(texture_render PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
    if(SKYLANDERS_GPU_TESTS)
        add_test(NAME texture_render_gpu COMMAND editor-texture-render-test)
        set_tests_properties(texture_render_gpu PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=xcb;SKYLANDERS_RENDERER=gpu")
    endif()
    add_test(NAME render_cli COMMAND "${NODE_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/render_cli.mjs"
        "$<TARGET_FILE:skylanders-level-editor>" "${CMAKE_CURRENT_SOURCE_DIR}/tests/mock_backend.mjs")
endif()

install(TARGETS skylanders-level-editor RUNTIME DESTINATION bin)
