cmake_minimum_required(VERSION 3.22.1)
project(minepilot_bridge LANGUAGES C)
add_library(minepilot_bridge SHARED minepilot_bridge.c)
set_target_properties(minepilot_bridge PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED YES)
